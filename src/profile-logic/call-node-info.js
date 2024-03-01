/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import { hashPath } from 'firefox-profiler/utils/path';

import type {
  IndexIntoFuncTable,
  CallNodeInfo,
  CallNodeTable,
  CallNodePath,
  IndexIntoCallNodeTable,
} from 'firefox-profiler/types';

/**
 * The implementation of the CallNodeInfo interface.
 */
export class CallNodeInfoImpl implements CallNodeInfo {
  // If true, call node indexes describe nodes in the inverted call tree.
  _isInverted: boolean;

  // The call node table. This is either the inverted or the non-inverted call
  // node table, depending on _isInverted.
  _callNodeTable: CallNodeTable;

  // The non-inverted call node table, regardless of _isInverted.
  _nonInvertedCallNodeTable: CallNodeTable;

  // The mapping of stack index to corresponding call node index. This maps to
  // either the inverted or the non-inverted call node table, depending on
  // _isInverted.
  _stackIndexToCallNodeIndex: Int32Array;

  // The mapping of stack index to corresponding non-inverted call node index.
  // This always maps to the non-inverted call node table, regardless of
  // _isInverted.
  _stackIndexToNonInvertedCallNodeIndex: Int32Array;

  // This is a Map<CallNodePathHash, IndexIntoCallNodeTable>. This map speeds up
  // the look-up process by caching every CallNodePath we handle which avoids
  // looking up parents again and again.
  _cache: Map<string, IndexIntoCallNodeTable> = new Map();

  constructor(
    callNodeTable: CallNodeTable,
    nonInvertedCallNodeTable: CallNodeTable,
    stackIndexToCallNodeIndex: Int32Array,
    stackIndexToNonInvertedCallNodeIndex: Int32Array,
    isInverted: boolean
  ) {
    this._callNodeTable = callNodeTable;
    this._nonInvertedCallNodeTable = nonInvertedCallNodeTable;
    this._stackIndexToCallNodeIndex = stackIndexToCallNodeIndex;
    this._stackIndexToNonInvertedCallNodeIndex =
      stackIndexToNonInvertedCallNodeIndex;
    this._isInverted = isInverted;
  }

  isInverted(): boolean {
    return this._isInverted;
  }

  getCallNodeTable(): CallNodeTable {
    return this._callNodeTable;
  }

  getStackIndexToCallNodeIndex(): Int32Array {
    return this._stackIndexToCallNodeIndex;
  }

  getNonInvertedCallNodeTable(): CallNodeTable {
    return this._nonInvertedCallNodeTable;
  }

  getStackIndexToNonInvertedCallNodeIndex(): Int32Array {
    return this._stackIndexToNonInvertedCallNodeIndex;
  }

  getCallNodePathFromIndex(
    callNodeIndex: IndexIntoCallNodeTable | null
  ): CallNodePath {
    if (callNodeIndex === null || callNodeIndex === -1) {
      return [];
    }

    const callNodePath = [];
    let cni = callNodeIndex;
    while (cni !== -1) {
      callNodePath.push(this._callNodeTable.func[cni]);
      cni = this._callNodeTable.prefix[cni];
    }
    callNodePath.reverse();
    return callNodePath;
  }

  getCallNodeIndexFromPath(
    callNodePath: CallNodePath
  ): IndexIntoCallNodeTable | null {
    const cache = this._cache;
    const hashFullPath = hashPath(callNodePath);
    const result = cache.get(hashFullPath);
    if (result !== undefined) {
      // The cache already has the result for the full path.
      return result;
    }

    // This array serves as a map and stores the hashes of callNodePath's
    // parents to speed up the algorithm. First we'll follow the tree from the
    // bottom towards the top, pushing hashes as we compute them, and then we'll
    // move back towards the bottom popping hashes from this array.
    const sliceHashes = [hashFullPath];

    // Step 1: find whether we already computed the index for one of the path's
    // parents, starting from the closest parent and looping towards the "top" of
    // the tree.
    // If we find it for one of the parents, we'll be able to start at this point
    // in the following look up.
    let i = callNodePath.length;
    let index;
    while (--i > 0) {
      // Looking up each parent for this call node, starting from the deepest node.
      // If we find a parent this makes it possible to start the look up from this location.
      const subPath = callNodePath.slice(0, i);
      const hash = hashPath(subPath);
      index = cache.get(hash);
      if (index !== undefined) {
        // Yay, we already have the result for a parent!
        break;
      }
      // Cache the hashed value because we'll need it later, after resolving this path.
      // Note we don't add the hash if we found the parent in the cache, so the
      // last added element here will accordingly be the first popped in the next
      // algorithm.
      sliceHashes.push(hash);
    }

    // Step 2: look for the requested path using the call node table, starting at
    // the parent we already know if we found one, and looping down the tree.
    // We're contributing to the cache at the same time.

    // `index` is undefined if no parent was found in the cache. In that case we
    // start from the start, and use `-1` which is the prefix we use to indicate
    // the root node.
    if (index === undefined) {
      // assert(i === 0);
      index = -1;
    }

    while (i < callNodePath.length) {
      // Resolving the index for subpath `callNodePath.slice(0, i+1)` given we
      // know the index for the subpath `callNodePath.slice(0, i)` (its parent).
      const func = callNodePath[i];
      const nextNodeIndex = this.getCallNodeIndexFromParentAndFunc(index, func);

      // We couldn't find this path into the call node table. This shouldn't
      // normally happen.
      if (nextNodeIndex === null) {
        return null;
      }

      // Contributing to the shared cache
      const hash = sliceHashes.pop();
      cache.set(hash, nextNodeIndex);

      index = nextNodeIndex;
      i++;
    }

    return index < 0 ? null : index;
  }

  getCallNodeIndexFromParentAndFunc(
    parent: IndexIntoCallNodeTable | -1,
    func: IndexIntoFuncTable
  ): IndexIntoCallNodeTable | null {
    const callNodeTable = this._callNodeTable;
    if (parent === -1) {
      if (callNodeTable.length === 0) {
        return null;
      }
    } else if (callNodeTable.subtreeRangeEnd[parent] === parent + 1) {
      // parent has no children.
      return null;
    }
    // Node children always come after their parents in the call node table,
    // that's why we start looping at `parent + 1`.
    // Note that because the root parent is `-1`, we correctly start at `0` when
    // we look for a root.
    const firstChild = parent + 1;
    for (
      let callNodeIndex = firstChild;
      callNodeIndex !== -1;
      callNodeIndex = callNodeTable.nextSibling[callNodeIndex]
    ) {
      if (callNodeTable.func[callNodeIndex] === func) {
        return callNodeIndex;
      }
    }

    return null;
  }
}
