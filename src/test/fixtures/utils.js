/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow
import { CallTree } from '../../profile-logic/call-tree';
import type { IndexIntoCallNodeTable } from '../../types/profile-derived';

export function getBoundingBox(width: number, height: number) {
  return {
    width,
    height,
    left: 0,
    x: 0,
    top: 0,
    y: 0,
    right: width,
    bottom: height,
  };
}

/**
 * This function formats a call tree into a human readable form, to make it easy
 * to assert certain relationships about the data structure in a really terse
 * and human-friendly fashion. For instance a call tree could become formatted
 * like so:
 *
 * [
 *   '- A (total: 4, self: —)',
 *   '  - B (total: 3, self: —)',
 *   '    - C (total: 1, self: 1)',
 *   '    - D (total: 1, self: 1)',
 *   '    - E (total: 1, self: 1)',
 *   '  - F (total: 1, self: 1)',
 * ]
 *
 * This structure is easy to read, avoids whitespace issues, and diffs really well
 * on the test output, showing where errors occur. Previously snapshots were used,
 * but the assertion was hidden in another file, which really hurt discoverability
 * and maintainability.
 */
export function formatTree(
  callTree: CallTree,
  children: IndexIntoCallNodeTable[] = callTree.getRoots(),
  depth: number = 0,
  lines: string[] = []
): string[] {
  const whitespace = Array(depth * 2 + 1).join(' ');

  children.forEach(callNodeIndex => {
    const { name, totalTime, selfTime } = callTree.getDisplayData(
      callNodeIndex
    );
    lines.push(
      `${whitespace}- ${name} (total: ${totalTime}, self: ${selfTime})`
    );
    formatTree(callTree, callTree.getChildren(callNodeIndex), depth + 1, lines);
  });

  return lines;
}
