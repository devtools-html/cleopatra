/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
/**
 * This file deals with old versions of the "processed" profile format,
 * i.e. the format that perf.html uses internally. Profiles in this format
 * can be saved out to files or uploaded to the profile store server, and we
 * want to be able to display profiles that were saved at any point in the
 * past, regardless of their version. So this file upgrades old profiles to
 * the current format.
 */

import { sortDataTable } from '../utils/data-table-utils';
import { resourceTypes } from './profile-data';
import {
  upgradeGCMinorMarker,
  upgradeGCMajorMarker_Processed8to9,
  convertPhaseTimes,
} from './convert-markers';
import { UniqueStringArray } from '../utils/unique-string-array';
import { timeCode } from '../utils/time-code';

export const CURRENT_VERSION = 14; // The current version of the "processed" profile format.

// Processed profiles before version 1 did not have a profile.meta.preprocessedProfileVersion
// field. Treat those as version zero.
const UNANNOTATED_VERSION = 0;

export function isProcessedProfile(profile: Object): boolean {
  // If this profile has a .meta.preprocessedProfileVersion field,
  // then it is definitely a preprocessed profile.
  if ('meta' in profile && 'preprocessedProfileVersion' in profile.meta) {
    return true;
  }

  // This could also be a pre-version 1 profile.
  return (
    'threads' in profile &&
    profile.threads.length >= 1 &&
    'stringArray' in profile.threads[0]
  );
}

/**
 * Upgrades the supplied profile to the current version, by mutating |profile|.
 * Throws an exception if the profile is too new.
 * @param {object} profile The "serialized" form of a processed profile,
 *                         i.e. stringArray instead of stringTable.
 */
export function upgradeProcessedProfileToCurrentVersion(profile: Object) {
  const profileVersion =
    profile.meta.preprocessedProfileVersion || UNANNOTATED_VERSION;
  if (profileVersion === CURRENT_VERSION) {
    return;
  }

  if (profileVersion > CURRENT_VERSION) {
    throw new Error(
      `Unable to parse a processed profile of version ${profileVersion} - are you running an outdated version of perf.html? ` +
        `The most recent version understood by this version of perf.html is version ${CURRENT_VERSION}.\n` +
        'You can try refreshing this page in case perf.html has updated in the meantime.'
    );
  }

  // Convert to CURRENT_VERSION, one step at a time.
  for (
    let destVersion = profileVersion + 1;
    destVersion <= CURRENT_VERSION;
    destVersion++
  ) {
    if (destVersion in _upgraders) {
      _upgraders[destVersion](profile);
    }
  }

  profile.meta.preprocessedProfileVersion = CURRENT_VERSION;
}

function _archFromAbi(abi) {
  if (abi === 'x86_64-gcc3') {
    return 'x86_64';
  }
  return abi;
}

function _getRealScriptURI(url) {
  if (url) {
    const urls = url.split(' -> ');
    return urls[urls.length - 1];
  }
  return url;
}

// _upgraders[i] converts from version i - 1 to version i.
// Every "upgrader" takes the profile as its single argument and mutates it.
/* eslint-disable no-useless-computed-key */
const _upgraders = {
  [1]: profile => {
    // Starting with version 1, markers are sorted.
    timeCode('sorting thread markers', () => {
      for (const thread of profile.threads) {
        sortDataTable(thread.markers, thread.markers.time, (a, b) => a - b);
      }
    });

    // And threads have proper names and processType fields.
    for (const thread of profile.threads) {
      if (!('processType' in thread)) {
        if (thread.name === 'Content') {
          thread.processType = 'tab';
          thread.name = 'GeckoMain';
        } else if (thread.name === 'Plugin') {
          thread.processType = 'plugin';
        } else {
          thread.processType = 'default';
        }
      }
    }
  },
  [2]: profile => {
    // pdbName -> debugName, add arch
    for (const thread of profile.threads) {
      for (const lib of thread.libs) {
        if (!('debugName' in lib)) {
          lib.debugName = lib.pdbName;
          lib.path = lib.name;
          lib.name = lib.debugName.endsWith('.pdb')
            ? lib.debugName.substr(0, lib.debugName.length - 4)
            : lib.debugName;
          lib.arch = _archFromAbi(profile.meta.abi);
          delete lib.pdbName;
          delete lib.pdbAge;
          delete lib.pdbSignature;
        }
      }
    }
  },
  [3]: profile => {
    // Make sure every lib has a debugPath property. We can't infer this
    // value from the other properties on the lib so we just set it to the
    // empty string.
    for (const thread of profile.threads) {
      for (const lib of thread.libs) {
        lib.debugPath = lib.debugPath || '';
      }
    }
  },
  [4]: profile => {
    profile.threads.forEach(thread => {
      const { funcTable, stringArray, resourceTable } = thread;
      const stringTable = new UniqueStringArray(stringArray);

      // resourceTable gains a new field ("host") and a new resourceType:
      // "webhost". Resources from http and https URLs are now grouped by
      // origin (protocol + host) into one webhost resource, instead of being
      // separate per-URL resources.
      // That means that multiple old resources can collapse into one new
      // resource. We need to keep track of such collapsing (using the
      // oldResourceToNewResourceMap) and then execute apply the changes to
      // the resource pointers in the funcTable.
      const newResourceTable = {
        length: 0,
        type: [],
        name: [],
        lib: [],
        icon: [],
        addonId: [],
        host: [],
      };
      function addLibResource(name, lib) {
        const index = newResourceTable.length++;
        newResourceTable.type[index] = resourceTypes.library;
        newResourceTable.name[index] = name;
        newResourceTable.lib[index] = lib;
      }
      function addWebhostResource(origin, host) {
        const index = newResourceTable.length++;
        newResourceTable.type[index] = resourceTypes.webhost;
        newResourceTable.name[index] = origin;
        newResourceTable.host[index] = host;
      }
      function addUrlResource(url) {
        const index = newResourceTable.length++;
        newResourceTable.type[index] = resourceTypes.url;
        newResourceTable.name[index] = url;
      }
      const oldResourceToNewResourceMap = new Map();
      const originToResourceIndex = new Map();
      for (
        let resourceIndex = 0;
        resourceIndex < resourceTable.length;
        resourceIndex++
      ) {
        if (resourceTable.type[resourceIndex] === resourceTypes.library) {
          oldResourceToNewResourceMap.set(
            resourceIndex,
            newResourceTable.length
          );
          addLibResource(
            resourceTable.name[resourceIndex],
            resourceTable.lib[resourceIndex]
          );
        } else if (resourceTable.type[resourceIndex] === resourceTypes.url) {
          const scriptURI = stringTable.getString(
            resourceTable.name[resourceIndex]
          );
          let newResourceIndex = null;
          let origin, host;
          try {
            const url = new URL(scriptURI);
            if (!(url.protocol === 'http:' || url.protocol === 'https:')) {
              throw new Error('not a webhost protocol');
            }
            origin = url.origin;
            host = url.host;
          } catch (e) {
            origin = scriptURI;
            host = null;
          }
          if (originToResourceIndex.has(origin)) {
            newResourceIndex = originToResourceIndex.get(origin);
          } else {
            newResourceIndex = newResourceTable.length;
            originToResourceIndex.set(origin, newResourceIndex);
            const originStringIndex = stringTable.indexForString(origin);
            if (host) {
              const hostIndex = stringTable.indexForString(host);
              addWebhostResource(originStringIndex, hostIndex);
            } else {
              const urlStringIndex = stringTable.indexForString(scriptURI);
              addUrlResource(urlStringIndex);
            }
          }
          oldResourceToNewResourceMap.set(resourceIndex, newResourceIndex);
        }
      }

      // funcTable gains two new fields: fileName and lineNumber. For C++ and
      // pseudo stack funcs, these fields are null. For JS funcs, they contain
      // the URL and the line number of the JS function.
      funcTable.fileName = [];
      funcTable.lineNumber = [];
      for (let funcIndex = 0; funcIndex < funcTable.length; funcIndex++) {
        const oldResourceIndex = funcTable.resource[funcIndex];
        if (oldResourceToNewResourceMap.has(oldResourceIndex)) {
          funcTable.resource[funcIndex] = oldResourceToNewResourceMap.get(
            oldResourceIndex
          );
        }
        let fileName = null;
        let lineNumber = null;
        if (funcTable.isJS[funcIndex]) {
          const funcName = stringTable.getString(funcTable.name[funcIndex]);
          const match =
            /^(.*) \((.*):([0-9]+)\)$/.exec(funcName) ||
            /^()(.*):([0-9]+)$/.exec(funcName);
          if (match) {
            const scriptURI = _getRealScriptURI(match[2]);
            if (match[1]) {
              funcTable.name[funcIndex] = stringTable.indexForString(match[1]);
            } else {
              funcTable.name[funcIndex] = stringTable.indexForString(scriptURI);
            }
            fileName = stringTable.indexForString(scriptURI);
            lineNumber = match[3] | 0;
          }
        }
        funcTable.fileName[funcIndex] = fileName;
        funcTable.lineNumber[funcIndex] = lineNumber;
      }

      thread.resourceTable = newResourceTable;
      thread.stringArray = stringTable.serializeToArray();
    });
  },
  [5]: profile => {
    // The "frameNumber" column was removed from the samples table.
    for (const thread of profile.threads) {
      delete thread.samples.frameNumber;
    }
  },
  [6]: profile => {
    // The type field for DOMEventMarkerPayload was renamed to eventType.
    for (const thread of profile.threads) {
      const { stringArray, markers } = thread;
      const stringTable = new UniqueStringArray(stringArray);
      const newDataArray = [];
      for (let i = 0; i < markers.length; i++) {
        const name = stringTable.getString(markers.name[i]);
        const data = markers.data[i];
        if (name === 'DOMEvent') {
          newDataArray[i] = {
            type: 'DOMEvent',
            startTime: data.startTime,
            endTime: data.endTime,
            eventType: data.type,
            phase: data.phase,
          };
        } else {
          newDataArray[i] = data;
        }
      }
      thread.markers.data = newDataArray;
    }
  },
  [7]: profile => {
    // Each thread has the following new attributes:
    //  - processShutdownTime: null if the process is still running, otherwise
    //    the shutdown time of the process in milliseconds relative to
    //    meta.startTime
    //  - pausedRanges: an array of
    //    { startTime: number | null, endTime: number | null, reason: string }
    //  - registerTime: The time this thread was registered with the profiler,
    //    in milliseconds since meta.startTime
    //  - unregisterTime: The time this thread was unregistered from the
    //    profiler, in milliseconds since meta.startTime, or null
    // We can't invent missing data, so just initialize everything with some
    // kind of empty value.
    for (const thread of profile.threads) {
      // "The profiler was never paused during the recorded range, and we never
      // collected a profile."
      thread.pausedRanges = [];
      // "All processes started at the same time."
      thread.processStartupTime = 0;
      // "All processes were still alive by the time the profile was captured."
      thread.processShutdownTime = null;
      // "All threads were registered instantly at process startup."
      thread.registerTime = 0;
      // "All threads were still alive by the time the profile was captured."
      thread.unregisterTime = null;
    }
  },
  [8]: profile => {
    // DOMEventMarkerPayload.timeStamp in content process should be in
    // milliseconds relative to meta.startTime.  Adjust it by adding
    // the thread.processStartupTime which is the delta to
    // meta.startTime.
    // Only the timeStamp property is updated because it's new and
    // perf.html wasn't updated to handle it when it appeared in
    // Firefox.
    for (const thread of profile.threads) {
      if (thread.processType === 'default') {
        continue;
      }
      const { stringArray, markers } = thread;
      const stringTable = new UniqueStringArray(stringArray);
      const newDataArray = [];
      for (let i = 0; i < markers.length; i++) {
        const name = stringTable.getString(markers.name[i]);
        const data = markers.data[i];
        if (name === 'DOMEvent' && data.timeStamp) {
          newDataArray[i] = {
            type: 'DOMEvent',
            startTime: data.startTime,
            endTime: data.endTime,
            timeStamp: data.timeStamp + thread.processStartupTime,
            eventType: data.eventType,
            phase: data.phase,
          };
        } else {
          newDataArray[i] = data;
        }
      }
      thread.markers.data = newDataArray;
    }
  },
  [9]: profile => {
    // Upgrade the GC markers
    for (const thread of profile.threads) {
      for (let i = 0; i < thread.markers.length; i++) {
        let marker = thread.markers.data[i];
        if (marker) {
          switch (marker.type) {
            case 'GCMinor':
              marker = upgradeGCMinorMarker(marker);
              break;
            case 'GCSlice':
              if (marker.timings && marker.timings.times) {
                marker.timings.phase_times = convertPhaseTimes(
                  marker.timings.times
                );
                delete marker.timings.times;
              }
              break;
            case 'GCMajor':
              marker = upgradeGCMajorMarker_Processed8to9(marker);
              break;
            default:
              break;
          }
          thread.markers.data[i] = marker;
        }
      }
    }
  },
  [10]: profile => {
    // Cause backtraces
    // Styles and reflow tracing markers supply call stacks that were captured
    // at the time that style or layout was invalidated. In version 9, this
    // call stack was embedded as a "syncProfile", which is essentially its own
    // small thread with an empty markers list and a samples list that only
    // contains one sample.
    // Starting with version 10, this is replaced with the CauseBacktrace type
    // which just has a "time" and a "stack" field, where the stack field is
    // a simple number, the stack index.
    for (const thread of profile.threads) {
      for (let i = 0; i < thread.markers.length; i++) {
        const marker = thread.markers.data[i];
        const adjustTimestampBy =
          thread.processType === 'default' ? 0 : thread.processStartupTime;
        if (marker) {
          if (
            'stack' in marker &&
            marker.stack &&
            marker.stack.samples.data.length > 0
          ) {
            const syncProfile = marker.stack;
            const stackIndex =
              syncProfile.samples.data[0][syncProfile.samples.schema.stack];
            const timeRelativeToProcess =
              syncProfile.samples.data[0][syncProfile.samples.schema.time];
            if (stackIndex !== null) {
              marker.cause = {
                time: timeRelativeToProcess + adjustTimestampBy,
                stack: stackIndex,
              };
            }
          }
          delete marker.stack;
        }
      }
    }
  },
  [11]: profile => {
    // Removed the startTime and endTime from DOMEventMarkerPayload and
    // made it a tracing marker instead. DOMEventMarkerPayload is no longer a
    // single marker, it requires a start and an end marker. Therefore, we have
    // to change the old DOMEvent marker and also create an end marker for each
    // DOMEvent.
    for (const thread of profile.threads) {
      const { stringArray, markers } = thread;
      if (markers.length === 0) {
        continue;
      }

      const stringTable = new UniqueStringArray(stringArray);
      const extraMarkers = [];
      for (let i = 0; i < markers.length; i++) {
        const name = stringTable.getString(markers.name[i]);
        const data = markers.data[i];
        if (name === 'DOMEvent') {
          markers.data[i] = {
            type: 'tracing',
            category: 'DOMEvent',
            timeStamp: data.timeStamp,
            interval: 'start',
            eventType: data.eventType,
            phase: data.phase,
          };

          extraMarkers.push({
            data: {
              type: 'tracing',
              category: 'DOMEvent',
              timeStamp: data.timeStamp,
              interval: 'end',
              eventType: data.eventType,
              phase: data.phase,
            },
            time: data.endTime,
            name: markers.name[i],
          });
        }
      }

      if (extraMarkers.length > 0) {
        extraMarkers.sort((a, b) => a.time - b.time);

        // Create a new markers table that includes both the old markers and
        // the markers from extraMarkers, sorted by time.
        const newMarkers = {
          length: 0,
          name: [],
          time: [],
          data: [],
        };

        // We compute the new markers list by doing one forward pass. Both the
        // old markers (stored in |markers|) and the extra markers are already
        // sorted by time.

        let nextOldMarkerIndex = 0;
        let nextOldMarkerTime = markers.time[0];
        let nextExtraMarkerIndex = 0;
        let nextExtraMarkerTime = extraMarkers[0].time;
        while (
          nextOldMarkerIndex < markers.length ||
          nextExtraMarkerIndex < extraMarkers.length
        ) {
          // Pick the next marker based on its timestamp.
          if (nextOldMarkerTime <= nextExtraMarkerTime) {
            newMarkers.name.push(markers.name[nextOldMarkerIndex]);
            newMarkers.time.push(markers.time[nextOldMarkerIndex]);
            newMarkers.data.push(markers.data[nextOldMarkerIndex]);
            newMarkers.length++;
            nextOldMarkerIndex++;
            nextOldMarkerTime =
              nextOldMarkerIndex < markers.length
                ? markers.time[nextOldMarkerIndex]
                : Infinity;
          } else {
            newMarkers.name.push(extraMarkers[nextExtraMarkerIndex].name);
            newMarkers.time.push(extraMarkers[nextExtraMarkerIndex].time);
            newMarkers.data.push(extraMarkers[nextExtraMarkerIndex].data);
            newMarkers.length++;
            nextExtraMarkerIndex++;
            nextExtraMarkerTime =
              nextExtraMarkerIndex < extraMarkers.length
                ? extraMarkers[nextExtraMarkerIndex].time
                : Infinity;
          }
        }

        thread.markers = newMarkers;
      }
    }
  },
  [12]: profile => {
    // profile.meta has a new property called "categories", which contains a
    // list of categories, which are objects with "name" and "color" properties.
    // The "category" column in the frameTable now refers to elements in this
    // list.
    //
    // Old category list:
    // https://searchfox.org/mozilla-central/rev/5a744713370ec47969595e369fd5125f123e6d24/js/public/ProfilingStack.h#193-201
    // New category list:
    // [To be inserted once the Gecko change lands in mozilla-central]
    profile.meta.categories = [
      {
        name: 'Idle',
        color: 'transparent',
      },
      {
        name: 'Other',
        color: 'grey',
      },
      {
        name: 'JavaScript',
        color: 'yellow',
      },
      {
        name: 'Layout',
        color: 'purple',
      },
      {
        name: 'Graphics',
        color: 'green',
      },
      {
        name: 'DOM',
        color: 'blue',
      },
      {
        name: 'GC / CC',
        color: 'orange',
      },
      {
        name: 'Network',
        color: 'lightblue',
      },
    ];
    const oldCategoryToNewCategory = {
      [1 << 4 /* OTHER */]: 1 /* Other */,
      [1 << 5 /* CSS */]: 3 /* Layout */,
      [1 << 6 /* JS */]: 2 /* JavaScript */,
      [1 << 7 /* GC */]: 6 /* GC / CC */,
      [1 << 8 /* CC */]: 6 /* GC / CC */,
      [1 << 9 /* NETWORK */]: 7 /* Network */,
      [1 << 10 /* GRAPHICS */]: 4 /* Graphics */,
      [1 << 11 /* STORAGE */]: 1 /* Other */,
      [1 << 12 /* EVENTS */]: 1 /* Other */,
    };
    for (const thread of profile.threads) {
      for (let i = 0; i < thread.frameTable.length; i++) {
        const oldCategory = thread.frameTable.category[i];
        if (oldCategory !== null) {
          const newCategory =
            oldCategory in oldCategoryToNewCategory
              ? oldCategoryToNewCategory[oldCategory]
              : 1 /* Other */;
          thread.frameTable.category[i] = newCategory;
        }
      }
    }
  },
  [13]: profile => {
    // The stackTable has a new column called "category", which is computed
    // from the stack's frame's category, or if that is null, from the stack's
    // prefix's category. For root stacks whose frame doesn't have a category,
    // the category is set to the grey category (usually something like "Other").
    // The same algorithm is used in profile processing, when the processed
    // profile's category column is derived from the gecko profile (which does
    // not have a category column in its stack table).
    const { meta, threads } = profile;
    const defaultCategory = meta.categories.findIndex(c => c.color === 'grey');

    for (const thread of threads) {
      const { stackTable, frameTable } = thread;
      stackTable.category = new Array(stackTable.length);
      for (let i = 0; i < stackTable.length; i++) {
        const frameIndex = stackTable.frame[i];
        const frameCategory = frameTable.category[frameIndex];
        if (frameCategory !== null) {
          stackTable.category[i] = frameCategory;
        } else {
          const prefix = stackTable.prefix[i];
          if (prefix !== null) {
            stackTable.category[i] = stackTable.category[prefix];
          } else {
            stackTable.category[i] = defaultCategory;
          }
        }
      }
    }
  },
  [14]: profile => {
    // Profiles are now required to have either a string or number pid. If the pid
    // is a string, then it is a generated name, if it is a number, it's the pid
    // generated by the system.
    const { threads } = profile;
    for (let threadIndex = 0; threadIndex < threads.length; threadIndex++) {
      const thread = threads[threadIndex];
      if (thread.pid === null || thread.pid === undefined) {
        thread.pid = `Unknown Process ${threadIndex + 1}`;
      }
    }
  },
};
/* eslint-enable no-useless-computed-key */
