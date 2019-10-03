/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { createSelector } from 'reselect';

import {
  getSelectedTab,
  getHiddenGlobalTracks,
  getHiddenLocalTracksByPid,
} from './url-state';
import { getGlobalTracks, getLocalTracksByPid } from './profile';
import { assertExhaustiveCheck, ensureExists } from '../utils/flow';
import {
  TRACK_SCREENSHOT_HEIGHT,
  TRACK_NETWORK_HEIGHT,
  TRACK_MEMORY_HEIGHT,
  TRACK_PROCESS_BLANK_HEIGHT,
  TIMELINE_RULER_HEIGHT,
  TIMELINE_SETTINGS_HEIGHT,
} from '../app-logic/constants';

import type { TabSlug } from '../app-logic/tabs-handling';
import type { AppState, AppViewState, UrlSetupPhase } from '../types/state';
import type { Selector } from '../types/store';
import type { CssPixels } from '../types/units';
import type { ThreadIndex } from '../types/profile';

/**
 * Simple selectors into the app state.
 */
export const getApp: Selector<AppState> = state => state.app;
export const getView: Selector<AppViewState> = state => getApp(state).view;
export const getUrlSetupPhase: Selector<UrlSetupPhase> = state =>
  getApp(state).urlSetupPhase;
export const getHasZoomedViaMousewheel: Selector<boolean> = state => {
  return getApp(state).hasZoomedViaMousewheel;
};
export const getIsSidebarOpen: Selector<boolean> = state =>
  getApp(state).isSidebarOpenPerPanel[getSelectedTab(state)];
export const getPanelLayoutGeneration: Selector<number> = state =>
  getApp(state).panelLayoutGeneration;
export const getLastVisibleThreadTabSlug: Selector<TabSlug> = state =>
  getApp(state).lastVisibleThreadTabSlug;
export const getTrackThreadHeights: Selector<
  Array<ThreadIndex | void>
> = state => getApp(state).trackThreadHeights;
export const getIsNewlyPublished: Selector<boolean> = state =>
  getApp(state).isNewlyPublished;

/**
 * This selector takes all of the tracks, and deduces the height in CssPixels
 * of the timeline. This is here to calculate the max-height of the timeline
 * for the splitter component.
 *
 * The height of the component is determined by the sizing of each track in the list.
 * Most sizes are pretty static, and are set through values in the component. The only
 * tricky value to determine is the thread track. These values get reported to the store
 * and get added in here.
 */
export const getTimelineHeight: Selector<null | CssPixels> = createSelector(
  getGlobalTracks,
  getLocalTracksByPid,
  getHiddenGlobalTracks,
  getHiddenLocalTracksByPid,
  getTrackThreadHeights,
  (
    globalTracks,
    localTracksByPid,
    hiddenGlobalTracks,
    hiddenLocalTracksByPid,
    trackThreadHeights
  ) => {
    let height = TIMELINE_RULER_HEIGHT + TIMELINE_SETTINGS_HEIGHT;
    const border = 1;

    for (const [trackIndex, globalTrack] of globalTracks.entries()) {
      if (!hiddenGlobalTracks.has(trackIndex)) {
        switch (globalTrack.type) {
          case 'screenshots':
            height += TRACK_SCREENSHOT_HEIGHT + border;
            break;
          case 'process':
            {
              // The thread tracks have enough complexity that it warrants measuring
              // them rather than statically using a value like the other tracks.
              const { mainThreadIndex } = globalTrack;
              if (mainThreadIndex === null) {
                height += TRACK_PROCESS_BLANK_HEIGHT + border;
              } else {
                const trackThreadHeight = trackThreadHeights[mainThreadIndex];
                if (trackThreadHeight === undefined) {
                  // The height isn't computed yet, return.
                  return null;
                }
                height += trackThreadHeight + border;
              }
            }
            break;
          default:
            throw assertExhaustiveCheck(globalTrack);
        }
      }
    }

    // Figure out which PIDs are hidden.
    const hiddenPids = new Set();
    for (const trackIndex of hiddenGlobalTracks) {
      const globalTrack = globalTracks[trackIndex];
      if (globalTrack.type === 'process') {
        hiddenPids.add(globalTrack.pid);
      }
    }

    for (const [pid, localTracks] of localTracksByPid) {
      if (hiddenPids.has(pid)) {
        // This track is hidden already.
        continue;
      }
      for (const [trackIndex, localTrack] of localTracks.entries()) {
        const hiddenLocalTracks = ensureExists(
          hiddenLocalTracksByPid.get(pid),
          'Could not look up the hidden local tracks from the given PID'
        );
        if (!hiddenLocalTracks.has(trackIndex)) {
          switch (localTrack.type) {
            case 'thread':
              {
                // The thread tracks have enough complexity that it warrants measuring
                // them rather than statically using a value like the other tracks.
                const trackThreadHeight =
                  trackThreadHeights[localTrack.threadIndex];
                if (trackThreadHeight === undefined) {
                  // The height isn't computed yet, return.
                  return null;
                }
                height += trackThreadHeight + border;
              }

              break;
            case 'network':
              height += TRACK_NETWORK_HEIGHT + border;
              break;
            case 'memory':
              height += TRACK_MEMORY_HEIGHT + border;
              break;
            default:
              throw assertExhaustiveCheck(localTrack);
          }
        }
      }
    }
    return height;
  }
);
