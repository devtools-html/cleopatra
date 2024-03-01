/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { oneLine } from 'common-tags';
import { timeCode } from '../utils/time-code';
import {
  getOriginAnnotationForFunc,
  getCategoryPairLabel,
  getBottomBoxInfoForCallNode,
} from './profile-data';
import { resourceTypes } from './data-structures';
import { getFunctionName } from './function-info';
import type {
  CategoryList,
  Thread,
  IndexIntoFuncTable,
  SamplesLikeTable,
  WeightType,
  CallNodeTable,
  CallNodePath,
  IndexIntoCallNodeTable,
  CallNodeInfo,
  CallNodeData,
  CallNodeDisplayData,
  Milliseconds,
  ExtraBadgeInfo,
  BottomBoxInfo,
  CallNodeLeafAndSummary,
  SelfAndTotal,
} from 'firefox-profiler/types';

import ExtensionIcon from '../../res/img/svg/extension.svg';
import { formatCallNodeNumber, formatPercent } from '../utils/format-numbers';
import { assertExhaustiveCheck, ensureExists } from '../utils/flow';
import * as ProfileData from './profile-data';
import type { CallTreeSummaryStrategy } from '../types/actions';

type CallNodeChildren = IndexIntoCallNodeTable[];

export type CallTreeTimings = {
  callNodeHasChildren: Uint8Array,
  self: Float32Array,
  leaf: Float32Array,
  total: Float32Array,
  rootTotalSummary: number,
};

function extractFaviconFromLibname(libname: string): string | null {
  try {
    const url = new URL('/favicon.ico', libname);
    if (url.protocol === 'http:') {
      // Upgrade http requests.
      url.protocol = 'https:';
    }
    return url.href;
  } catch (e) {
    console.error(
      'Error while extracing the favicon from the libname',
      libname
    );
    return null;
  }
}

interface CallTreeInternal {
  hasChildren(callNodeIndex: IndexIntoCallNodeTable): boolean;
  createChildren(nodeIndex: IndexIntoCallNodeTable): CallNodeChildren;
  createRoots(): CallNodeChildren;
  getSelfAndTotal(nodeIndex: IndexIntoCallNodeTable): SelfAndTotal;
  findHeaviestPathInSubtree(
    callNodeIndex: IndexIntoCallNodeTable
  ): CallNodePath;
}

export class CallTreeInternalImpl implements CallTreeInternal {
  _callNodeInfo: CallNodeInfo;
  _callNodeTable: CallNodeTable;
  _callTreeTimings: CallTreeTimings;
  _callNodeHasChildren: Uint8Array; // A table column matching the callNodeTable

  constructor(callNodeInfo: CallNodeInfo, callTreeTimings: CallTreeTimings) {
    this._callNodeInfo = callNodeInfo;
    this._callNodeTable = callNodeInfo.getCallNodeTable();
    this._callTreeTimings = callTreeTimings;
    this._callNodeHasChildren = callTreeTimings.callNodeHasChildren;
  }

  _getFirstChildIndex(
    callNodeIndex: IndexIntoCallNodeTable | -1
  ): IndexIntoCallNodeTable | -1 {
    if (callNodeIndex === -1) {
      return this._callNodeTable.length !== 0 ? 0 : -1;
    }
    const subtreeRangeEnd = this._callNodeTable.subtreeRangeEnd[callNodeIndex];
    if (subtreeRangeEnd !== callNodeIndex + 1) {
      return callNodeIndex + 1;
    }
    return -1;
  }

  createRoots() {
    return this.createChildren(-1);
  }

  createChildren(callNodeIndex: IndexIntoCallNodeTable): CallNodeChildren {
    const firstChild = this._getFirstChildIndex(callNodeIndex);
    const children = [];
    for (
      let childCallNodeIndex = firstChild;
      childCallNodeIndex !== -1;
      childCallNodeIndex = this._callNodeTable.nextSibling[childCallNodeIndex]
    ) {
      const childTotalSummary = this._callTreeTimings.total[childCallNodeIndex];
      const childHasChildren = this._callNodeHasChildren[childCallNodeIndex];

      if (childTotalSummary !== 0 || childHasChildren !== 0) {
        children.push(childCallNodeIndex);
      }
    }
    children.sort(
      (a, b) =>
        Math.abs(this._callTreeTimings.total[b]) -
        Math.abs(this._callTreeTimings.total[a])
    );
    return children;
  }

  hasChildren(callNodeIndex: IndexIntoCallNodeTable): boolean {
    return this._callNodeHasChildren[callNodeIndex] !== 0;
  }

  getSelfAndTotal(callNodeIndex: IndexIntoCallNodeTable): SelfAndTotal {
    const self = this._callTreeTimings.self[callNodeIndex];
    const total = this._callTreeTimings.total[callNodeIndex];
    return { self, total };
  }

  findHeaviestPathInSubtree(
    callNodeIndex: IndexIntoCallNodeTable
  ): CallNodePath {
    const rangeEnd = this._callNodeTable.subtreeRangeEnd[callNodeIndex];

    // Find the call node with the highest leaf time.
    let maxNode = -1;
    let maxAbs = 0;
    for (let nodeIndex = callNodeIndex; nodeIndex < rangeEnd; nodeIndex++) {
      const nodeLeaf = Math.abs(this._callTreeTimings.leaf[nodeIndex]);
      if (maxNode === -1 || nodeLeaf > maxAbs) {
        maxNode = nodeIndex;
        maxAbs = nodeLeaf;
      }
    }

    return this._callNodeInfo.getCallNodePathFromIndex(maxNode);
  }
}

export class CallTree {
  _categories: CategoryList;
  _internal: CallTreeInternal;
  _callNodeInfo: CallNodeInfo;
  _callNodeTable: CallNodeTable;
  _thread: Thread;
  _rootTotalSummary: number;
  _displayDataByIndex: Map<IndexIntoCallNodeTable, CallNodeDisplayData>;
  // _children is indexed by IndexIntoCallNodeTable. Since they are
  // integers, using an array directly is faster than going through a Map.
  _children: Array<CallNodeChildren>;
  _roots: IndexIntoCallNodeTable[];
  _isHighPrecision: boolean;
  _weightType: WeightType;

  constructor(
    thread: Thread,
    categories: CategoryList,
    callNodeInfo: CallNodeInfo,
    internal: CallTreeInternal,
    rootTotalSummary: number,
    isHighPrecision: boolean,
    weightType: WeightType
  ) {
    this._categories = categories;
    this._internal = internal;
    this._callNodeInfo = callNodeInfo;
    this._callNodeTable = callNodeInfo.getCallNodeTable();
    this._thread = thread;
    this._rootTotalSummary = rootTotalSummary;
    this._displayDataByIndex = new Map();
    this._children = [];
    this._roots = internal.createRoots();
    this._isHighPrecision = isHighPrecision;
    this._weightType = weightType;
  }

  getRoots() {
    return this._roots;
  }

  getChildren(callNodeIndex: IndexIntoCallNodeTable): CallNodeChildren {
    let children = this._children[callNodeIndex];
    if (children === undefined) {
      children = this._internal.createChildren(callNodeIndex);
      this._children[callNodeIndex] = children;
    }
    return children;
  }

  hasChildren(callNodeIndex: IndexIntoCallNodeTable): boolean {
    return this._internal.hasChildren(callNodeIndex);
  }

  _addDescendantsToSet(
    callNodeIndex: IndexIntoCallNodeTable,
    set: Set<IndexIntoCallNodeTable>
  ): void {
    for (const child of this.getChildren(callNodeIndex)) {
      set.add(child);
      this._addDescendantsToSet(child, set);
    }
  }

  getAllDescendants(
    callNodeIndex: IndexIntoCallNodeTable
  ): Set<IndexIntoCallNodeTable> {
    const result = new Set();
    this._addDescendantsToSet(callNodeIndex, result);
    return result;
  }

  getParent(
    callNodeIndex: IndexIntoCallNodeTable
  ): IndexIntoCallNodeTable | -1 {
    return this._callNodeTable.prefix[callNodeIndex];
  }

  getDepth(callNodeIndex: IndexIntoCallNodeTable): number {
    return this._callNodeTable.depth[callNodeIndex];
  }

  getNodeData(callNodeIndex: IndexIntoCallNodeTable): CallNodeData {
    const funcIndex = this._callNodeTable.func[callNodeIndex];
    const funcName = this._thread.stringTable.getString(
      this._thread.funcTable.name[funcIndex]
    );

    const { self, total } = this._internal.getSelfAndTotal(callNodeIndex);
    const totalRelative = total / this._rootTotalSummary;
    const selfRelative = self / this._rootTotalSummary;

    return {
      funcName,
      total,
      totalRelative,
      self,
      selfRelative,
    };
  }

  _getInliningBadge(
    callNodeIndex: IndexIntoCallNodeTable,
    funcName: string
  ): ExtraBadgeInfo | void {
    const calledFunction = getFunctionName(funcName);
    const inlinedIntoNativeSymbol =
      this._callNodeTable.sourceFramesInlinedIntoSymbol[callNodeIndex];
    if (inlinedIntoNativeSymbol === null) {
      return undefined;
    }

    if (inlinedIntoNativeSymbol === -1) {
      return {
        name: 'divergent-inlining',
        vars: { calledFunction },
        localizationId: 'CallTree--divergent-inlining-badge',
        contentFallback: '',
        titleFallback: `Some calls to ${calledFunction} were inlined by the compiler.`,
      };
    }

    const outerFunction = getFunctionName(
      this._thread.stringTable.getString(
        this._thread.nativeSymbols.name[inlinedIntoNativeSymbol]
      )
    );
    return {
      name: 'inlined',
      vars: { calledFunction, outerFunction },
      localizationId: 'CallTree--inlining-badge',
      contentFallback: '(inlined)',
      titleFallback: `Calls to ${calledFunction} were inlined into ${outerFunction} by the compiler.`,
    };
  }

  getDisplayData(callNodeIndex: IndexIntoCallNodeTable): CallNodeDisplayData {
    let displayData: CallNodeDisplayData | void =
      this._displayDataByIndex.get(callNodeIndex);
    if (displayData === undefined) {
      const { funcName, total, totalRelative, self } =
        this.getNodeData(callNodeIndex);
      const funcIndex = this._callNodeTable.func[callNodeIndex];
      const categoryIndex = this._callNodeTable.category[callNodeIndex];
      const subcategoryIndex = this._callNodeTable.subcategory[callNodeIndex];
      const badge = this._getInliningBadge(callNodeIndex, funcName);
      const resourceIndex = this._thread.funcTable.resource[funcIndex];
      const resourceType = this._thread.resourceTable.type[resourceIndex];
      const isFrameLabel = resourceIndex === -1;
      const libName = this._getOriginAnnotation(funcIndex);
      const weightType = this._weightType;

      let iconSrc = null;
      let icon = null;

      if (resourceType === resourceTypes.webhost) {
        icon = iconSrc = extractFaviconFromLibname(libName);
      } else if (resourceType === resourceTypes.addon) {
        iconSrc = ExtensionIcon;

        const resourceNameIndex =
          this._thread.resourceTable.name[resourceIndex];
        const iconText = this._thread.stringTable.getString(resourceNameIndex);
        icon = iconText;
      }

      const formattedTotal = formatCallNodeNumber(
        weightType,
        this._isHighPrecision,
        total
      );
      const formattedSelf = formatCallNodeNumber(
        weightType,
        this._isHighPrecision,
        self
      );
      const totalPercent = `${formatPercent(totalRelative)}`;

      let ariaLabel;
      let totalWithUnit;
      let selfWithUnit;
      switch (weightType) {
        case 'tracing-ms': {
          totalWithUnit = `${formattedTotal}ms`;
          selfWithUnit = `${formattedSelf}ms`;
          ariaLabel = oneLine`
              ${funcName},
              running time is ${totalWithUnit} (${totalPercent}),
              self time is ${selfWithUnit}
            `;
          break;
        }
        case 'samples': {
          // TODO - L10N pluralization
          totalWithUnit =
            total === 1
              ? `${formattedTotal} sample`
              : `${formattedTotal} samples`;
          selfWithUnit =
            self === 1 ? `${formattedSelf} sample` : `${formattedSelf} samples`;
          ariaLabel = oneLine`
            ${funcName},
            running count is ${totalWithUnit} (${totalPercent}),
            self count is ${selfWithUnit}
          `;
          break;
        }
        case 'bytes': {
          totalWithUnit = `${formattedTotal} bytes`;
          selfWithUnit = `${formattedSelf} bytes`;
          ariaLabel = oneLine`
            ${funcName},
            total size is ${totalWithUnit} (${totalPercent}),
            self size is ${selfWithUnit}
          `;
          break;
        }
        default:
          throw assertExhaustiveCheck(weightType, 'Unhandled WeightType.');
      }

      displayData = {
        total: total === 0 ? '—' : formattedTotal,
        totalWithUnit: total === 0 ? '—' : totalWithUnit,
        self: self === 0 ? '—' : formattedSelf,
        selfWithUnit: self === 0 ? '—' : selfWithUnit,
        totalPercent,
        name: funcName,
        lib: libName.slice(0, 1000),
        // Dim platform pseudo-stacks.
        isFrameLabel,
        badge,
        categoryName: getCategoryPairLabel(
          this._categories,
          categoryIndex,
          subcategoryIndex
        ),
        categoryColor: this._categories[categoryIndex].color,
        iconSrc,
        icon,
        ariaLabel,
      };
      this._displayDataByIndex.set(callNodeIndex, displayData);
    }
    return displayData;
  }

  _getOriginAnnotation(funcIndex: IndexIntoFuncTable): string {
    return getOriginAnnotationForFunc(
      funcIndex,
      this._thread.funcTable,
      this._thread.resourceTable,
      this._thread.stringTable
    );
  }

  getBottomBoxInfoForCallNode(
    callNodeIndex: IndexIntoCallNodeTable
  ): BottomBoxInfo {
    return getBottomBoxInfoForCallNode(
      callNodeIndex,
      this._callNodeInfo,
      this._thread
    );
  }

  /**
   * Take a CallNodeIndex, and compute an inverted path for it.
   *
   * e.g:
   *   (invertedPath, invertedCallTree) => path
   *   (path, callTree) => invertedPath
   *
   * Call trees are sorted with the CallNodes with the heaviest total time as the first
   * entry. This function walks to the tip of the heaviest branches to find the leaf node,
   * then construct an inverted CallNodePath with the result. This gives a pretty decent
   * result, but it doesn't guarantee that it will select the heaviest CallNodePath for the
   * INVERTED call tree. This would require doing a round trip through the reducers or
   * some other mechanism in order to first calculate the next inverted call tree. This is
   * probably not worth it, so go ahead and use the uninverted call tree, as it's probably
   * good enough.
   */
  findHeavyPathToSameFunctionAfterInversion(
    callNodeIndex: IndexIntoCallNodeTable | null
  ): CallNodePath {
    if (callNodeIndex === null) {
      return [];
    }
    const heaviestPath =
      this._internal.findHeaviestPathInSubtree(callNodeIndex);
    const startingDepth = this._callNodeTable.depth[callNodeIndex];
    const partialPath = heaviestPath.slice(startingDepth);
    return partialPath.reverse();
  }
}

// In an inverted profile, all the amount of self unit (time, bytes, count, etc.) is
// accounted to the root nodes. So `callNodeSelf` will be 0 for all non-root nodes.
function _getInvertedCallNodeSelf(
  callNodeLeaf: Float32Array,
  callNodeTable: CallNodeTable
): Float32Array {
  // Compute an array that maps the callNodeIndex to its root.
  const callNodeToRoot = new Int32Array(callNodeTable.length);

  // Compute the self time during the same loop.
  const callNodeSelf = new Float32Array(callNodeTable.length);

  for (
    let callNodeIndex = 0;
    callNodeIndex < callNodeTable.length;
    callNodeIndex++
  ) {
    const prefixCallNode = callNodeTable.prefix[callNodeIndex];
    if (prefixCallNode === -1) {
      // callNodeIndex is a root node
      callNodeToRoot[callNodeIndex] = callNodeIndex;
    } else {
      // The callNodeTable guarantees that a callNode's prefix always comes
      // before the callNode; prefix references are always to lower callNode
      // indexes and never to higher indexes.
      // We are iterating the callNodeTable in forwards direction (starting at
      // index 0) so we know that we have already visited the current call
      // node's prefix call node and can reuse its stored root node, which
      // recursively is the value we're looking for.
      callNodeToRoot[callNodeIndex] = callNodeToRoot[prefixCallNode];
    }
    callNodeSelf[callNodeToRoot[callNodeIndex]] += callNodeLeaf[callNodeIndex];
  }

  return callNodeSelf;
}

/**
 * Compute the leaf time for each call node, and the sum of the absolute leaf
 * values.
 */
export function computeCallNodeLeafAndSummary(
  samples: SamplesLikeTable,
  sampleIndexToCallNodeIndex: Array<null | IndexIntoCallNodeTable>,
  callNodeCount: number
): CallNodeLeafAndSummary {
  const callNodeLeaf = new Float32Array(callNodeCount);
  for (
    let sampleIndex = 0;
    sampleIndex < sampleIndexToCallNodeIndex.length;
    sampleIndex++
  ) {
    const callNodeIndex = sampleIndexToCallNodeIndex[sampleIndex];
    if (callNodeIndex !== null) {
      const weight = samples.weight ? samples.weight[sampleIndex] : 1;
      callNodeLeaf[callNodeIndex] += weight;
    }
  }

  // Workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=1858310
  const abs = Math.abs;

  let rootTotalSummary = 0;
  for (let callNodeIndex = 0; callNodeIndex < callNodeCount; callNodeIndex++) {
    rootTotalSummary += abs(callNodeLeaf[callNodeIndex]);
  }

  return { callNodeLeaf, rootTotalSummary };
}

/**
 * This computes all of the count and timing information displayed in the calltree.
 * It takes into account both the normal tree, and the inverted tree.
 */
export function computeCallTreeTimings(
  callNodeInfo: CallNodeInfo,
  callNodeLeafAndSummary: CallNodeLeafAndSummary
): CallTreeTimings {
  const callNodeTable = callNodeInfo.getCallNodeTable();
  const { callNodeLeaf, rootTotalSummary } = callNodeLeafAndSummary;

  // The self values depend on whether the call tree is inverted: In an inverted
  // tree, all the self time is in the roots.
  const callNodeSelf = callNodeInfo.isInverted()
    ? _getInvertedCallNodeSelf(callNodeLeaf, callNodeTable)
    : callNodeLeaf;

  // Compute the following variables:
  const callNodeTotalSummary = new Float32Array(callNodeTable.length);
  const callNodeHasChildren = new Uint8Array(callNodeTable.length);

  // We loop the call node table in reverse, so that we find the children
  // before their parents, and the total is known at the time we reach a
  // node.
  for (
    let callNodeIndex = callNodeTable.length - 1;
    callNodeIndex >= 0;
    callNodeIndex--
  ) {
    callNodeTotalSummary[callNodeIndex] += callNodeLeaf[callNodeIndex];
    const hasChildren = callNodeHasChildren[callNodeIndex] !== 0;
    const hasTotalValue = callNodeTotalSummary[callNodeIndex] !== 0;

    if (!hasChildren && !hasTotalValue) {
      continue;
    }

    const prefixCallNode = callNodeTable.prefix[callNodeIndex];
    if (prefixCallNode !== -1) {
      callNodeTotalSummary[prefixCallNode] +=
        callNodeTotalSummary[callNodeIndex];
      callNodeHasChildren[prefixCallNode] = 1;
    }
  }

  return {
    self: callNodeSelf,
    leaf: callNodeLeaf,
    total: callNodeTotalSummary,
    callNodeHasChildren,
    rootTotalSummary,
  };
}

/**
 * An exported interface to get an instance of the CallTree class.
 */
export function getCallTree(
  thread: Thread,
  callNodeInfo: CallNodeInfo,
  categories: CategoryList,
  callTreeTimings: CallTreeTimings,
  weightType: WeightType
): CallTree {
  return timeCode('getCallTree', () => {
    return new CallTree(
      thread,
      categories,
      callNodeInfo,
      new CallTreeInternalImpl(callNodeInfo, callTreeTimings),
      callTreeTimings.rootTotalSummary,
      Boolean(thread.isJsTracer),
      weightType
    );
  });
}

/**
 * This function takes the call tree summary strategy, and finds the appropriate data
 * structure. This can then be used by the call tree and other UI to report on the data.
 */
export function extractSamplesLikeTable(
  thread: Thread,
  strategy: CallTreeSummaryStrategy
): SamplesLikeTable {
  switch (strategy) {
    case 'timing':
      return thread.samples;
    case 'js-allocations':
      return ensureExists(
        thread.jsAllocations,
        'Expected the NativeAllocationTable to exist when using a "js-allocation" strategy'
      );
    case 'native-retained-allocations': {
      const nativeAllocations = ensureExists(
        thread.nativeAllocations,
        'Expected the NativeAllocationTable to exist when using a "native-allocation" strategy'
      );

      /* istanbul ignore if */
      if (!nativeAllocations.memoryAddress) {
        throw new Error(
          'Attempting to filter by retained allocations data that is missing the memory addresses.'
        );
      }
      return ProfileData.filterToRetainedAllocations(nativeAllocations);
    }
    case 'native-allocations':
      return ProfileData.filterToAllocations(
        ensureExists(
          thread.nativeAllocations,
          'Expected the NativeAllocationTable to exist when using a "native-allocations" strategy'
        )
      );
    case 'native-deallocations-sites':
      return ProfileData.filterToDeallocationsSites(
        ensureExists(
          thread.nativeAllocations,
          'Expected the NativeAllocationTable to exist when using a "native-deallocations-sites" strategy'
        )
      );
    case 'native-deallocations-memory': {
      const nativeAllocations = ensureExists(
        thread.nativeAllocations,
        'Expected the NativeAllocationTable to exist when using a "native-deallocations-memory" strategy'
      );

      /* istanbul ignore if */
      if (!nativeAllocations.memoryAddress) {
        throw new Error(
          'Attempting to filter by retained allocations data that is missing the memory addresses.'
        );
      }

      return ProfileData.filterToDeallocationsMemory(
        ensureExists(
          nativeAllocations,
          'Expected the NativeAllocationTable to exist when using a "js-allocation" strategy'
        )
      );
    }
    /* istanbul ignore next */
    default:
      throw assertExhaustiveCheck(strategy);
  }
}

/**
 * This function is extremely similar to computeCallNodeLeafAndSummary,
 * but is specialized for converting sample counts into traced timing. Samples
 * don't have duration information associated with them, it's mostly how long they
 * were observed to be running. This function computes the timing the exact same
 * way that the stack chart will display the information, so that timing information
 * will agree. In the past, timing was computed by samplingInterval * sampleCount.
 * This caused confusion when switching to the trace-based views when the numbers
 * did not agree. In order to remove confusion, we can show the sample counts,
 * plus the traced timing, which is a compromise between correctness, and consistency.
 */
export function computeCallNodeTracedLeafAndSummary(
  samples: SamplesLikeTable,
  sampleIndexToCallNodeIndex: Array<IndexIntoCallNodeTable | null>,
  callNodeCount: number,
  interval: Milliseconds
): CallNodeLeafAndSummary | null {
  if (samples.weightType !== 'samples' || samples.weight) {
    // Only compute for the samples weight types that have no weights. If a samples
    // table has weights then it's a diff profile. Currently, we aren't calculating
    // diff profiles, but it could be possible to compute this information twice,
    // once for positive weights, and once for negative weights, then sum them
    // together. At this time it's not really worth it.
    //
    // See https://github.com/firefox-devtools/profiler/issues/2615
    return null;
  }

  const callNodeLeaf = new Float32Array(callNodeCount);
  let rootTotalSummary = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length - 1; sampleIndex++) {
    const callNodeIndex = sampleIndexToCallNodeIndex[sampleIndex];
    if (callNodeIndex !== null) {
      const sampleTracedTime =
        samples.time[sampleIndex + 1] - samples.time[sampleIndex];
      callNodeLeaf[callNodeIndex] += sampleTracedTime;
      rootTotalSummary += sampleTracedTime;
    }
  }

  if (samples.length > 0) {
    const callNodeIndex = sampleIndexToCallNodeIndex[samples.length - 1];
    if (callNodeIndex !== null) {
      // Use the sampling interval for the last sample.
      const sampleTracedTime = interval;
      callNodeLeaf[callNodeIndex] += sampleTracedTime;
      rootTotalSummary += sampleTracedTime;
    }
  }

  return { callNodeLeaf, rootTotalSummary };
}
