/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import {
  extractFuncsAndResourcesFromFrameLocations,
  processProfile,
  serializeProfile,
  unserializeProfileOfArbitraryFormat,
  sanitizePII,
} from '../../profile-logic/process-profile';
import { UniqueStringArray } from '../../utils/unique-string-array';
import {
  createGeckoProfile,
  createGeckoCounter,
} from '../fixtures/profiles/gecko-profile';
import { ensureExists } from '../../utils/flow';
import type { RemoveProfileInformation } from '../../types/profile-derived';

describe('extract functions and resource from location strings', function() {
  // These location strings are turned into the proper funcs.
  const locations = [
    // Extract unsymbolicated memory and match them to libraries.
    '0xc0ff33',
    '0xe0ff33',

    // Extract C++ function names and resources
    'cppFunction1 (in c++ resource name1) + 123',
    'cppFunction2 (in c++ resource name2) (234:345)',
    'cppFunction3 (in c++ resource name2)',

    // Extract JS functions URL information
    'jsFunction1 (http://script.com/one.js:456:1)',
    'http://script.com/one.js:456:1',

    // Extension locations
    'moz-extension://bf3bb73c-919c-4fef-95c4-070a19fdaf85/background.js:1:0',
    'moz-extension://fa2edf9c-c45f-4445-b819-c09e3f2d58d5/content.js:1:0',
    'backgroundFunction (moz-extension://bf3bb73c-919c-4fef-95c4-070a19fdaf85/background.js:2:1)',
    'contentfunction (moz-extension://fa2edf9c-c45f-4445-b819-c09e3f2d58d5/content.js:2:1)',

    // Something unknown
    'mysterious location',
  ];
  const libs = [
    // This library will match the '0xc0ff33' location.
    {
      start: 0xc00000,
      end: 0xd00000,
      offset: 0,
      arch: '',
      name: 'No symbols library',
      path: '',
      debugName: '',
      debugPath: '',
      breakpadId: '',
    },
    // This library will match the '0xe0ff33' location, and it has an offset.
    {
      start: 0xe01000,
      end: 0xf00000,
      offset: 0x1000,
      arch: '',
      name: 'No symbols library',
      path: '',
      debugName: '',
      debugPath: '',
      breakpadId: '',
    },
  ];
  const stringTable = new UniqueStringArray();
  const locationIndexes = locations.map(location =>
    stringTable.indexForString(location)
  );
  const extensions = {
    baseURL: [
      'moz-extension://bf3bb73c-919c-4fef-95c4-070a19fdaf85/',
      'moz-extension://fa2edf9c-c45f-4445-b819-c09e3f2d58d5/',
    ],
    id: ['geckoprofiler@mozilla.com', 'screenshots@mozilla.org'],
    name: ['Gecko Profiler', 'Firefox Screenshots'],
    length: 2,
  };

  it('extracts the information for all different types of locations', function() {
    const [
      funcTable,
      resourceTable,
      frameFuncs,
    ] = extractFuncsAndResourcesFromFrameLocations(
      locationIndexes,
      locationIndexes.map(() => false),
      stringTable,
      libs,
      extensions
    );

    expect(
      frameFuncs.map((funcIndex, locationIndex) => {
        // Map all the results into a human readable object for easy snapshotting.
        const locationName = locations[locationIndex];

        const funcName = stringTable.getString(funcTable.name[funcIndex]);
        const resourceIndex = funcTable.resource[funcIndex];
        const address = funcTable.address[funcIndex];
        const isJS = funcTable.isJS[funcIndex];
        const fileNameIndex = funcTable.fileName[funcIndex];
        const fileName =
          fileNameIndex === null ? null : stringTable.getString(fileNameIndex);
        const lineNumber = funcTable.lineNumber[funcIndex];
        const columnNumber = funcTable.columnNumber[funcIndex];

        let libIndex, resourceName, host, resourceType;
        if (resourceIndex === -1) {
          resourceName = null;
          host = null;
          resourceType = null;
        } else {
          const hostStringIndex = resourceTable.host[resourceIndex];
          libIndex = resourceTable.lib[resourceIndex];
          resourceName = stringTable.getString(
            resourceTable.name[resourceIndex]
          );
          host =
            hostStringIndex === undefined
              ? null
              : stringTable.getString(hostStringIndex);
          resourceType = resourceTable.type[resourceIndex];
        }
        const lib =
          libIndex === undefined || libIndex === null || libIndex === -1
            ? undefined
            : libs[libIndex];

        return [
          locationName,
          {
            funcName,
            isJS,
            resourceIndex,
            address,
            fileName,
            lineNumber,
            columnNumber,
            libIndex,
            resourceName,
            host,
            resourceType,
            lib,
          },
        ];
      })
    ).toMatchSnapshot();
  });
});

describe('gecko counters processing', function() {
  function setup() {
    // Create a gecko profile with counters.
    const findMainThread = profile =>
      ensureExists(
        profile.threads.find(thread => thread.name === 'GeckoMain'),
        'There should be a GeckoMain thread in the Gecko profile'
      );

    const parentGeckoProfile = createGeckoProfile();
    const [childGeckoProfile] = parentGeckoProfile.processes;

    const parentPid = findMainThread(parentGeckoProfile).pid;
    const childPid = findMainThread(childGeckoProfile).pid;
    expect(parentPid).toEqual(3333);
    expect(childPid).toEqual(2222);

    const parentCounter = createGeckoCounter(
      findMainThread(parentGeckoProfile)
    );
    const childCounter = createGeckoCounter(findMainThread(childGeckoProfile));
    parentGeckoProfile.counters = [parentCounter];
    childGeckoProfile.counters = [childCounter];
    return {
      parentGeckoProfile,
      parentPid,
      childPid,
      parentCounter,
      childCounter,
    };
  }

  it('can extract the counter information correctly', function() {
    const { parentGeckoProfile, parentPid, childPid } = setup();
    const processedProfile = processProfile(parentGeckoProfile);
    const counters = ensureExists(
      processedProfile.counters,
      'Expected to find counters on the processed profile'
    );
    expect(counters.length).toBe(2);
    expect(counters[0].pid).toBe(parentPid);
    expect(counters[1].pid).toBe(childPid);

    const findMainThreadIndexByPid = (pid: number): number =>
      processedProfile.threads.findIndex(
        thread => thread.name === 'GeckoMain' && thread.pid === pid
      );

    expect(counters[0].mainThreadIndex).toBe(
      findMainThreadIndexByPid(parentPid)
    );
    expect(counters[1].mainThreadIndex).toBe(
      findMainThreadIndexByPid(childPid)
    );
  });

  it('offsets the counter timing for child processes', function() {
    const { parentGeckoProfile, parentCounter, childCounter } = setup();
    const processedProfile = processProfile(parentGeckoProfile);
    const processedCounters = ensureExists(processedProfile.counters);

    const originalTime = [0, 1, 2, 3, 4, 5, 6];
    const offsetTime = originalTime.map(n => n + 1000);

    const extractTime = counter =>
      counter.sample_groups.samples.data.map(tuple => tuple[0]);

    // The original times and parent process are not offset.
    expect(extractTime(parentCounter)).toEqual(originalTime);
    expect(extractTime(childCounter)).toEqual(originalTime);
    expect(processedCounters[0].sampleGroups.samples.time).toEqual(
      originalTime
    );

    // The subprocess times are offset when processed:
    expect(processedCounters[1].sampleGroups.samples.time).toEqual(offsetTime);
  });
});

describe('serializeProfile', function() {
  it('should produce a parsable profile string', async function() {
    const profile = processProfile(createGeckoProfile());
    const serialized = serializeProfile(profile);
    expect(JSON.parse.bind(null, serialized)).not.toThrow();
  });

  it('should produce the same profile in a roundtrip', async function() {
    const profile = processProfile(createGeckoProfile());
    const serialized = serializeProfile(profile);
    const roundtrip = await unserializeProfileOfArbitraryFormat(serialized);
    // FIXME: Uncomment this line after resolving `undefined` serialization issue
    // See: https://github.com/firefox-devtools/profiler/issues/1599
    // expect(profile).toEqual(roundtrip);

    const secondSerialized = serializeProfile(roundtrip);
    const secondRountrip = await unserializeProfileOfArbitraryFormat(
      secondSerialized
    );
    expect(roundtrip).toEqual(secondRountrip);
  });
});

describe('sanitizePII', function() {
  function getRemoveProfileInformation(
    customFields: Object
  ): RemoveProfileInformation {
    return {
      shouldRemoveThreads: new Set(),
      shouldRemoveThreadsWithScreenshots: new Set(),
      shouldRemoveNetworkUrls: false,
      shouldRemoveAllUrls: false,
      shouldFilterToCommittedRange: null,
      shouldRemoveExtensions: false,
      ...customFields,
    };
  }
  it('should sanitize the threads if they are provided', function() {
    const profile = processProfile(createGeckoProfile());
    // There are 3 threads in the beginning.
    expect(profile.threads.length).toEqual(3);
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreads: new Set([0, 2]),
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    // First and last threads are removed and now there are only 1 thread.
    expect(sanitizedProfile.threads.length).toEqual(1);
  });

  it('should sanitize the screenshots if they are provided', function() {
    const profile = processProfile(createGeckoProfile());
    // Checking if we have screenshot markers just in case.
    let screenshotMarkerFound = false;
    for (const thread of profile.threads) {
      for (const data of thread.markers.data) {
        if (data && data.type === 'CompositorScreenshot') {
          screenshotMarkerFound = true;
          break;
        }
      }
    }
    expect(screenshotMarkerFound).toEqual(true);

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreadsWithScreenshots: new Set([0, 1, 2]),
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    screenshotMarkerFound = false;
    for (const thread of sanitizedProfile.threads) {
      for (const data of thread.markers.data) {
        if (data && data.type === 'CompositorScreenshot') {
          screenshotMarkerFound = true;
          break;
        }
      }
    }
    expect(screenshotMarkerFound).toEqual(false);
  });

  it('should sanitize the pages information', function() {
    const profile = processProfile(createGeckoProfile());

    for (const page of ensureExists(profile.pages)) {
      expect(page.url.includes('http')).toBe(true);
    }

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveNetworkUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const page of ensureExists(sanitizedProfile.pages)) {
      expect(page.url.includes('http')).toBe(false);
    }
  });

  it('should sanitize the network URLS', function() {
    const profile = processProfile(createGeckoProfile());
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveNetworkUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const thread of sanitizedProfile.threads) {
      const stringArray = thread.stringTable.serializeToArray();
      for (let i = 0; i < thread.markers.length; i++) {
        const currentMarker = thread.markers.data[i];
        if (
          currentMarker &&
          currentMarker.type &&
          currentMarker.type === 'Network'
        ) {
          expect(currentMarker.URI).toBeFalsy();
          expect(currentMarker.RedirectURI).toBeFalsy();
          const stringIndex = thread.markers.name[i];
          expect(stringArray[stringIndex].includes('http')).toBe(false);
        }
      }
    }
  });

  it('should sanitize all the URLS', function() {
    const profile = processProfile(createGeckoProfile());
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveAllUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const thread of sanitizedProfile.threads) {
      const stringArray = thread.stringTable.serializeToArray();
      for (const string of stringArray) {
        // We are keeping the http(s) and removing the rest.
        // That's why we can't test it with `includes('http')`.
        // Tested `.com` here since all of the test urls have .com in it
        expect(string.includes('.com')).toBe(false);
      }
    }
  });

  it('should sanitize extensions', function() {
    const profile = processProfile(createGeckoProfile());
    expect(profile.meta.extensions).not.toEqual(undefined);
    // For flow
    if (profile.meta.extensions !== undefined) {
      const extensions = profile.meta.extensions;
      expect(extensions.length).toEqual(3);
      expect(extensions.id.length).toEqual(3);
      expect(extensions.name.length).toEqual(3);
      expect(extensions.baseURL.length).toEqual(3);
    }
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveExtensions: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    expect(sanitizedProfile.meta.extensions).not.toEqual(undefined);
    // For flow
    if (sanitizedProfile.meta.extensions !== undefined) {
      const extensions = sanitizedProfile.meta.extensions;
      expect(extensions.length).toEqual(0);
      expect(extensions.id.length).toEqual(0);
      expect(extensions.name.length).toEqual(0);
      expect(extensions.baseURL.length).toEqual(0);
    }
  });
});
