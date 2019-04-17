/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { getSelectedTab, getDataSource } from '../selectors/url-state';
import { getTrackThreadHeights } from '../selectors/app';
import { sendAnalytics } from '../utils/analytics';
import type { ThreadIndex } from '../types/profile';
import type { CssPixels } from '../types/units';
import type { Action, ThunkAction } from '../types/store';
import type { TabSlug } from '../app-logic/tabs-handling';
import type { UrlState } from '../types/state';

export function changeSelectedTab(selectedTab: TabSlug): ThunkAction<void> {
  return (dispatch, getState) => {
    const previousTab = getSelectedTab(getState());
    if (previousTab !== selectedTab) {
      sendAnalytics({
        hitType: 'pageview',
        page: selectedTab,
      });
      dispatch({
        type: 'CHANGE_SELECTED_TAB',
        selectedTab,
      });
    }
  };
}

export function profilePublished(hash: string): Action {
  return {
    type: 'PROFILE_PUBLISHED',
    hash,
  };
}

export function changeProfilesToCompare(profiles: string[]): Action {
  return {
    type: 'CHANGE_PROFILES_TO_COMPARE',
    profiles,
  };
}

export function urlSetupDone(): ThunkAction<void> {
  return (dispatch, getState) => {
    dispatch({ type: 'URL_SETUP_DONE' });

    // After the url setup is done, we can successfully query our state about its
    // initial page.
    const dataSource = getDataSource(getState());
    sendAnalytics({
      hitType: 'pageview',
      page: dataSource === 'none' ? 'home' : getSelectedTab(getState()),
    });
    sendAnalytics({
      hitType: 'event',
      eventCategory: 'datasource',
      eventAction: dataSource,
    });
  };
}

export function show404(url: string): Action {
  return { type: 'ROUTE_NOT_FOUND', url };
}

export function changeSidebarOpenState(tab: TabSlug, isOpen: boolean): Action {
  return { type: 'CHANGE_SIDEBAR_OPEN_STATE', tab, isOpen };
}

export function invalidatePanelLayout(): Action {
  return { type: 'INCREMENT_PANEL_LAYOUT_GENERATION' };
}

/**
 * The viewport component provides a hint to use shift to zoom scroll. The first
 * time a user does this, the hint goes away.
 */
export function setHasZoomedViaMousewheel() {
  return { type: 'HAS_ZOOMED_VIA_MOUSEWHEEL' };
}

/**
 * This function is called when a browser navigation event happens. A new UrlState
 * is generated when the window.location is serialized, or the state is pulled out of
 * the history API.
 */
export function updateUrlState(newUrlState: UrlState | null): Action {
  return { type: 'UPDATE_URL_STATE', newUrlState };
}

export const reportTrackThreadHeight = (
  threadIndex: ThreadIndex,
  height: CssPixels
): ThunkAction<void> => (dispatch, getState) => {
  const trackThreadHeights = getTrackThreadHeights(getState());
  const previousHeight = trackThreadHeights[threadIndex];
  if (previousHeight !== height) {
    // Guard against unnecessary dispatches. This could happen frequently.
    dispatch({
      type: 'UPDATE_TRACK_THREAD_HEIGHT',
      height,
      threadIndex,
    });
  }
};

/**
 * This action dismisses the newly published state. This happens when a user first
 * uploads a profile. We only want to remember this when we fist open the profile.
 */
export function dismissNewlyPublished(): Action {
  return { type: 'DISMISS_NEWLY_PUBLISHED' };
}
