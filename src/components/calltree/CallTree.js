/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import React, { PureComponent } from 'react';
import explicitConnect from '../../utils/connect';
import TreeView from '../shared/TreeView';
import CallTreeEmptyReasons from './CallTreeEmptyReasons';
import NodeIcon from '../shared/NodeIcon';
import { getCallNodePathFromIndex } from '../../profile-logic/profile-data';
import {
  getInvertCallstack,
  getImplementationFilter,
  getSearchStringsAsRegExp,
  getSelectedThreadIndex,
} from '../../selectors/url-state';
import {
  getScrollToSelectionGeneration,
  getFocusCallTreeGeneration,
  getPreviewSelection,
} from '../../selectors/profile';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import { getIconsWithClassNames } from '../../selectors/icons';
import {
  changeSelectedCallNode,
  changeExpandedCallNodes,
  addTransformToStack,
} from '../../actions/profile-view';

import type { IconWithClassName, State } from '../../types/state';
import type { CallTree } from '../../profile-logic/call-tree';
import type { ImplementationFilter } from '../../types/actions';
import type { ThreadIndex } from '../../types/profile';
import type {
  CallNodeInfo,
  IndexIntoCallNodeTable,
  CallNodeDisplayData,
} from '../../types/profile-derived';
import type { Column } from '../shared/TreeView';
import type { ConnectedProps } from '../../utils/connect';

type StateProps = {|
  +threadIndex: ThreadIndex,
  +scrollToSelectionGeneration: number,
  +focusCallTreeGeneration: number,
  +tree: CallTree,
  +callNodeInfo: CallNodeInfo,
  +selectedCallNodeIndex: IndexIntoCallNodeTable | null,
  +expandedCallNodeIndexes: Array<IndexIntoCallNodeTable | null>,
  +searchStringsRegExp: RegExp | null,
  +disableOverscan: boolean,
  +invertCallstack: boolean,
  +implementationFilter: ImplementationFilter,
  +icons: IconWithClassName[],
  +callNodeMaxDepth: number,
|};

type DispatchProps = {|
  +changeSelectedCallNode: typeof changeSelectedCallNode,
  +changeExpandedCallNodes: typeof changeExpandedCallNodes,
  +addTransformToStack: typeof addTransformToStack,
|};

type Props = ConnectedProps<{||}, StateProps, DispatchProps>;

class CallTreeComponent extends PureComponent<Props> {
  _fixedColumns: Column[] = [
    { propName: 'totalTimePercent', title: '' },
    { propName: 'totalTime', title: 'Running Time (ms)' },
    { propName: 'selfTime', title: 'Self (ms)' },
    { propName: 'icon', title: '', component: NodeIcon },
  ];
  _mainColumn: Column = { propName: 'name', title: '' };
  _appendageColumn: Column = { propName: 'lib', title: '' };
  _treeView: TreeView<CallNodeDisplayData> | null = null;
  _takeTreeViewRef = treeView => (this._treeView = treeView);

  componentDidMount() {
    this.focus();
    if (this.props.selectedCallNodeIndex === null) {
      this.procureInterestingInitialSelection();
    } else if (this._treeView) {
      this._treeView.scrollSelectionIntoView();
    }
  }

  componentDidUpdate(prevProps) {
    if (
      this.props.scrollToSelectionGeneration >
      prevProps.scrollToSelectionGeneration
    ) {
      if (this._treeView) {
        this._treeView.scrollSelectionIntoView();
      }
    }

    if (
      this.props.focusCallTreeGeneration > prevProps.focusCallTreeGeneration
    ) {
      this.focus();
    }
  }

  focus() {
    if (this._treeView) {
      this._treeView.focus();
    }
  }

  _onSelectedCallNodeChange = (newSelectedCallNode: IndexIntoCallNodeTable) => {
    const { callNodeInfo, threadIndex, changeSelectedCallNode } = this.props;
    changeSelectedCallNode(
      threadIndex,
      getCallNodePathFromIndex(newSelectedCallNode, callNodeInfo.callNodeTable)
    );
  };

  _onExpandedCallNodesChange = (
    newExpandedCallNodeIndexes: Array<IndexIntoCallNodeTable | null>
  ) => {
    const { callNodeInfo, threadIndex, changeExpandedCallNodes } = this.props;
    changeExpandedCallNodes(
      threadIndex,
      newExpandedCallNodeIndexes.map(callNodeIndex =>
        getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
      )
    );
  };

  procureInterestingInitialSelection() {
    // Expand the heaviest callstack up to a certain depth and select the frame
    // at that depth.
    const { tree, expandedCallNodeIndexes } = this.props;
    const newExpandedCallNodeIndexes = expandedCallNodeIndexes.slice();
    const maxInterestingDepth = 17; // scientifically determined
    let currentCallNodeIndex = tree.getRoots()[0];
    if (currentCallNodeIndex === undefined) {
      // This tree is empty.
      return;
    }
    newExpandedCallNodeIndexes.push(currentCallNodeIndex);
    for (let i = 0; i < maxInterestingDepth; i++) {
      const children = tree.getChildren(currentCallNodeIndex);
      if (children.length === 0) {
        break;
      }
      currentCallNodeIndex = children[0];
      newExpandedCallNodeIndexes.push(currentCallNodeIndex);
    }
    this._onExpandedCallNodesChange(newExpandedCallNodeIndexes);
    this._onSelectedCallNodeChange(currentCallNodeIndex);
  }

  render() {
    const {
      tree,
      selectedCallNodeIndex,
      expandedCallNodeIndexes,
      searchStringsRegExp,
      disableOverscan,
      callNodeMaxDepth,
    } = this.props;
    if (tree.getRoots().length === 0) {
      return <CallTreeEmptyReasons />;
    }
    return (
      <TreeView
        tree={tree}
        fixedColumns={this._fixedColumns}
        mainColumn={this._mainColumn}
        appendageColumn={this._appendageColumn}
        onSelectionChange={this._onSelectedCallNodeChange}
        onExpandedNodesChange={this._onExpandedCallNodesChange}
        selectedNodeId={selectedCallNodeIndex}
        expandedNodeIds={expandedCallNodeIndexes}
        highlightRegExp={searchStringsRegExp}
        disableOverscan={disableOverscan}
        ref={this._takeTreeViewRef}
        contextMenuId="CallNodeContextMenu"
        maxNodeDepth={callNodeMaxDepth}
        icons={this.props.icons}
        rowHeight={16}
        indentWidth={10}
      />
    );
  }
}

export default explicitConnect<{||}, StateProps, DispatchProps>({
  mapStateToProps: (state: State) => ({
    threadIndex: getSelectedThreadIndex(state),
    scrollToSelectionGeneration: getScrollToSelectionGeneration(state),
    focusCallTreeGeneration: getFocusCallTreeGeneration(state),
    tree: selectedThreadSelectors.getCallTree(state),
    callNodeInfo: selectedThreadSelectors.getCallNodeInfo(state),
    selectedCallNodeIndex: selectedThreadSelectors.getSelectedCallNodeIndex(
      state
    ),
    expandedCallNodeIndexes: selectedThreadSelectors.getExpandedCallNodeIndexes(
      state
    ),
    searchStringsRegExp: getSearchStringsAsRegExp(state),
    disableOverscan: getPreviewSelection(state).isModifying,
    invertCallstack: getInvertCallstack(state),
    implementationFilter: getImplementationFilter(state),
    icons: getIconsWithClassNames(state),
    callNodeMaxDepth: selectedThreadSelectors.getCallNodeMaxDepth(state),
  }),
  mapDispatchToProps: {
    changeSelectedCallNode,
    changeExpandedCallNodes,
    addTransformToStack,
  },
  options: { withRef: true },
  component: CallTreeComponent,
});
