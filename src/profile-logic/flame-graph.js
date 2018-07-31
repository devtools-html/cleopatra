/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import type { UnitIntervalOfProfileRange } from '../types/units';
import type { IndexIntoCallNodeTable } from '../types/profile-derived';

import * as CallTree from './call-tree';

export type FlameGraphDepth = number;
export type IndexIntoFlameGraphTiming = number;

/**
 * FlameGraphTiming is an array containing data used for rendering the
 * flame graph. Each element in the array describes one row in the
 * graph. Each such element in turn contains one or more functions,
 * drawn as boxes with start and end positions, represented as unit
 * intervals of the profile range. It should be noted that start and
 * end does not represent units of time, but only positions on the
 * x-axis, derived from an alphabetical sort.
 *
 * callNode allows extracting information such as function names which
 * are shown in the flame graph.
 *
 * selfTimeRelative contains the self time relative to the total time,
 * which is used to color the drawn functions.
 */
export type FlameGraphTiming = Array<{
  start: UnitIntervalOfProfileRange[],
  end: UnitIntervalOfProfileRange[],
  selfTimeRelative: Array<number>,
  callNode: IndexIntoCallNodeTable[],
  length: number,
}>;

type Stack = Array<{
  depth: number,
  nodeIndex: IndexIntoCallNodeTable,
}>;

/**
 * Build a FlameGraphTiming table from a call tree.
 */
export function getFlameGraphTiming(
  callTree: CallTree.CallTree
): FlameGraphTiming {
  const [children, pointers, lengths] = callTree.getAllChildren();
  const timing = [];
  // Array of call nodes to recursively process in the loop below.
  // Start with the roots of the call tree.
  const stack: Stack = callTree
    .getRoots()
    .map(nodeIndex => ({ nodeIndex, depth: 0 }));

  // Keep track of time offset by depth level.
  const timeOffset = [0.0];

  while (stack.length) {
    const { depth, nodeIndex } = stack.pop();
    const { totalTimeRelative, selfTimeRelative } = callTree.getNodeData(
      nodeIndex
    );

    // Select an existing row, or create a new one.
    let row = timing[depth];
    if (row === undefined) {
      row = {
        start: [],
        end: [],
        selfTimeRelative: [],
        callNode: [],
        length: 0,
      };
      timing[depth] = row;
    }

    // Compute the timing information.
    row.start.push(timeOffset[depth]);
    row.end.push(timeOffset[depth] + totalTimeRelative);
    row.selfTimeRelative.push(selfTimeRelative);
    row.callNode.push(nodeIndex);
    row.length++;

    // Before we add the total time of this node to the time offset,
    // we'll make sure that the first child (if any) begins with the
    // same time offset.
    timeOffset[depth + 1] = timeOffset[depth];
    timeOffset[depth] += totalTimeRelative;

    // Since we're popping the stack at the top of the while loop, put
    // in the children in reverse order here to retain the ascending
    // order when processing them.
    let length = lengths[nodeIndex];
    let i = pointers[nodeIndex];
    while (length--) {
      stack.push({ nodeIndex: children[i++], depth: depth + 1 });
    }
  }
  return timing;
}
