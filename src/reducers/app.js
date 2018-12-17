/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { combineReducers } from 'redux';
import { tabSlugs } from '../app-logic/tabs-handling';

import type { TabSlug } from '../app-logic/tabs-handling';
import type {
  AppState,
  AppViewState,
  IsSidebarOpenPerPanelState,
  Reducer,
} from '../types/state';

const view: Reducer<AppViewState> = (
  state = { phase: 'INITIALIZING' },
  action
) => {
  if (state.phase === 'DATA_LOADED') {
    // Let's not come back at another phase if we're already displaying a profile
    return state;
  }

  switch (action.type) {
    case 'TEMPORARY_ERROR':
      return {
        phase: 'INITIALIZING',
        additionalData: {
          message: action.error.message,
          attempt: action.error.attempt,
        },
      };
    case 'FATAL_ERROR':
      return { phase: 'FATAL_ERROR', error: action.error };
    case 'WAITING_FOR_PROFILE_FROM_ADDON':
      return { phase: 'INITIALIZING' };
    case 'ROUTE_NOT_FOUND':
      return { phase: 'ROUTE_NOT_FOUND' };
    case 'RECEIVE_ZIP_FILE':
    case 'VIEW_PROFILE':
      return { phase: 'DATA_LOADED' };
    default:
      return state;
  }
};

const isUrlSetupDone: Reducer<boolean> = (state = false, action) => {
  switch (action.type) {
    case 'URL_SETUP_DONE':
      return true;
    default:
      return state;
  }
};

const hasZoomedViaMousewheel: Reducer<boolean> = (state = false, action) => {
  switch (action.type) {
    case 'HAS_ZOOMED_VIA_MOUSEWHEEL': {
      return true;
    }
    default:
      return state;
  }
};

function _getNoSidebarsOpen() {
  const state = {};
  tabSlugs.forEach(tabSlug => (state[tabSlug] = false));
  return state;
}

const isSidebarOpenPerPanel: Reducer<IsSidebarOpenPerPanelState> = (
  state = _getNoSidebarsOpen(),
  action
) => {
  switch (action.type) {
    case 'CHANGE_SIDEBAR_OPEN_STATE': {
      const { tab, isOpen } = action;
      // Due to how this action will be dispatched we'll always have the value
      // changed so we don't need the performance optimization of checking the
      // stored value against the new value.
      return {
        ...state,
        [tab]: isOpen,
      };
    }
    default:
      return state;
  }
};

/**
 * The panels that make up the timeline, details view, and sidebar can all change
 * their sizes depending on the state that is fed to them. In order to control
 * the invalidations of this sizing information, provide a "generation" value that
 * increases monotonically for any change that potentially changes the sizing of
 * any of the panels. This provides a mechanism for subscribing components to
 * deterministically update their sizing correctly.
 */
const panelLayoutGeneration: Reducer<number> = (state = 0, action) => {
  switch (action.type) {
    case 'INCREMENT_PANEL_LAYOUT_GENERATION':
    // Sidebar: (fallthrough)
    case 'CHANGE_SIDEBAR_OPEN_STATE':
    // Timeline: (fallthrough)
    case 'HIDE_GLOBAL_TRACK':
    case 'SHOW_GLOBAL_TRACK':
    case 'ISOLATE_PROCESS':
    case 'ISOLATE_PROCESS_MAIN_THREAD':
    case 'HIDE_LOCAL_TRACK':
    case 'SHOW_LOCAL_TRACK':
    case 'ISOLATE_LOCAL_TRACK':
    // Committed range changes: (fallthrough)
    case 'COMMIT_RANGE':
    case 'POP_COMMITTED_RANGES':
      return state + 1;
    default:
      return state;
  }
};

/**
 * Clicking on tracks can switch between different tabs. This piece of state holds
 * on to the last relevant thread-based tab that was viewed. This makes the UX nicer
 * for when a user clicks on a Network track, and gets taken to the Network
 * panel, then clicks on a thread or process track. With this state we can smoothly
 * transition them back to the panel they were using.
 */
const lastVisibleThreadTabSlug: Reducer<TabSlug> = (
  state = 'calltree',
  action
) => {
  switch (action.type) {
    case 'SELECT_TRACK':
    case 'CHANGE_SELECTED_TAB':
      if (action.selectedTab !== 'network-chart') {
        return action.selectedTab;
      }
      return state;
    default:
      return state;
  }
};

const appStateReducer: Reducer<AppState> = combineReducers({
  view,
  isUrlSetupDone,
  hasZoomedViaMousewheel,
  isSidebarOpenPerPanel,
  panelLayoutGeneration,
  lastVisibleThreadTabSlug,
});

export default appStateReducer;
