/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { createSelector } from 'reselect';

import { computeProfileFlowInfo } from '../profile-logic/marker-data';
import type { ProfileFlowInfo } from '../profile-logic/marker-data';
import { getThreadSelectors } from './per-thread';
import type { ThreadSelectors } from './per-thread';
import { getThreads, getMarkerSchema } from './profile';

import type { Selector, State, Marker } from 'firefox-profiler/types';

function _arraysShallowEqual(arr1: any[], arr2: any[]): boolean {
  return arr1.length === arr2.length && arr1.every((val, i) => val === arr2[i]);
}

function _createSelectorForAllThreads<T>(
  f: (ThreadSelectors, State) => T
): Selector<T[]> {
  let previousOutputPerThread = [];
  return function recomputeSelectorForAllThreads(state: State): T[] {
    const threads = getThreads(state);
    let outputPerThread = threads.map((_thread, i) => {
      const threadSelectors = getThreadSelectors(i);
      return f(threadSelectors, state);
    });
    if (_arraysShallowEqual(outputPerThread, previousOutputPerThread)) {
      outputPerThread = previousOutputPerThread;
    }
    previousOutputPerThread = outputPerThread;
    return outputPerThread;
  };
}

export const getFullMarkerListPerThread: Selector<Marker[][]> =
  _createSelectorForAllThreads(({ getFullMarkerList }, state) =>
    getFullMarkerList(state)
  );

export const getProfileFlowInfo: Selector<ProfileFlowInfo> = createSelector(
  getFullMarkerListPerThread,
  getThreads,
  getMarkerSchema,
  computeProfileFlowInfo
);
