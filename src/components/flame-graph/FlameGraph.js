/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import explicitConnect from '../../utils/connect';
import FlameGraphCanvas from './Canvas';
import {
  selectedThreadSelectors,
  getCommittedRange,
  getProfileViewOptions,
  getPreviewSelection,
  getScrollToSelectionGeneration,
} from '../../reducers/profile-view';
import { getSelectedThreadIndex } from '../../reducers/url-state';
import ContextMenuTrigger from '../shared/ContextMenuTrigger';
import { getCallNodePathFromIndex } from '../../profile-logic/profile-data';
import { changeSelectedCallNode } from '../../actions/profile-view';
import { getIconsWithClassNames } from '../../reducers/icons';
import { BackgroundImageStyleDef } from '../shared/StyleDef';

import type { Thread } from '../../types/profile';
import type { Milliseconds } from '../../types/units';
import type { FlameGraphTiming } from '../../profile-logic/flame-graph';
import type { PreviewSelection } from '../../types/actions';
import type {
  CallNodeInfo,
  IndexIntoCallNodeTable,
} from '../../types/profile-derived';
import type { CallTree } from '../../profile-logic/call-tree';
import type { IconWithClassName } from '../../types/reducers';

import type {
  ExplicitConnectOptions,
  ConnectedProps,
} from '../../utils/connect';

require('./FlameGraph.css');

const STACK_FRAME_HEIGHT = 16;

type StateProps = {|
  +thread: Thread,
  +maxStackDepth: number,
  +timeRange: { start: Milliseconds, end: Milliseconds },
  +previewSelection: PreviewSelection,
  +flameGraphTiming: FlameGraphTiming,
  +callTree: CallTree,
  +callNodeInfo: CallNodeInfo,
  +threadIndex: number,
  +selectedCallNodeIndex: IndexIntoCallNodeTable | null,
  +isCallNodeContextMenuVisible: boolean,
  +scrollToSelectionGeneration: number,
  +icons: IconWithClassName[],
|};
type DispatchProps = {|
  +changeSelectedCallNode: typeof changeSelectedCallNode,
|};
type Props = ConnectedProps<{||}, StateProps, DispatchProps>;

class FlameGraph extends React.PureComponent<Props> {
  _container: HTMLDivElement | null = null;

  _onSelectedCallNodeChange = (
    callNodeIndex: IndexIntoCallNodeTable | null
  ) => {
    const { callNodeInfo, threadIndex, changeSelectedCallNode } = this.props;
    changeSelectedCallNode(
      threadIndex,
      getCallNodePathFromIndex(callNodeIndex, callNodeInfo.callNodeTable)
    );
  };

  _takeContainerRef = (container: HTMLDivElement | null) => {
    this._container = container;
  };

  _focus = () => {
    if (this._container) {
      this._container.focus();
    }
  };

  _handleKeyDown = (event: SyntheticKeyboardEvent<HTMLElement>) => {
    const {
      callNodeInfo: { callNodeTable },
      threadIndex,
      changeSelectedCallNode,
      selectedCallNodeIndex,
      callTree,
      flameGraphTiming,
    } = this.props;

    if (selectedCallNodeIndex === null) {
      return;
    }

    console.log('!!! event.key', event.key);
    switch (event.key) {
      case 'ArrowDown': {
        const prefix = callNodeTable.prefix[selectedCallNodeIndex];
        if (prefix !== -1) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(prefix, callNodeTable)
          );
        }
        break;
      }
      case 'ArrowUp': {
        const [callNodeIndex] = callTree.getChildren(selectedCallNodeIndex);
        if (callNodeIndex !== undefined) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(callNodeIndex, callNodeTable)
          );
        }
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        const depth = callNodeTable.depth[selectedCallNodeIndex];
        const row = flameGraphTiming[depth];
        const rowIndex = row.callNode.indexOf(selectedCallNodeIndex);
        const callNodeIndex = row.callNode[rowIndex + direction];
        if (callNodeIndex !== undefined) {
          changeSelectedCallNode(
            threadIndex,
            getCallNodePathFromIndex(callNodeIndex, callNodeTable)
          );
        }
        break;
      }
      default:
        break;
    }
  };

  componentDidMount() {
    this._focus();
  }

  render() {
    const {
      thread,
      threadIndex,
      maxStackDepth,
      flameGraphTiming,
      callTree,
      callNodeInfo,
      timeRange,
      previewSelection,
      selectedCallNodeIndex,
      isCallNodeContextMenuVisible,
      scrollToSelectionGeneration,
      icons,
    } = this.props;

    const maxViewportHeight = maxStackDepth * STACK_FRAME_HEIGHT;

    return (
      <div
        className="flameGraphContent"
        ref={this._takeContainerRef}
        onMouseDown={this._focus}
        onKeyDown={this._handleKeyDown}
        tabIndex={0}
      >
        {icons.map(({ className, icon }) => (
          <BackgroundImageStyleDef
            className={className}
            url={icon}
            key={className}
          />
        ))}
        <ContextMenuTrigger
          id="CallNodeContextMenu"
          attributes={{
            className: 'treeViewContextMenu',
          }}
        >
          <FlameGraphCanvas
            key={threadIndex}
            // ChartViewport props
            viewportProps={{
              timeRange,
              maxViewportHeight,
              maximumZoom: 1,
              previewSelection,
              startsAtBottom: true,
              disableHorizontalMovement: true,
              viewportNeedsUpdate,
            }}
            // FlameGraphCanvas props
            chartProps={{
              thread,
              maxStackDepth,
              flameGraphTiming,
              callTree,
              callNodeInfo,
              selectedCallNodeIndex,
              scrollToSelectionGeneration,
              stackFrameHeight: STACK_FRAME_HEIGHT,
              onSelectionChange: this._onSelectedCallNodeChange,
              disableTooltips: isCallNodeContextMenuVisible,
            }}
          />
        </ContextMenuTrigger>
      </div>
    );
  }
}

function viewportNeedsUpdate() {
  // By always returning false we prevent the viewport from being
  // reset and scrolled all the way to the bottom when doing
  // operations like changing the time selection or applying a
  // transform.
  return false;
}

const options: ExplicitConnectOptions<{||}, StateProps, DispatchProps> = {
  mapStateToProps: state => {
    return {
      thread: selectedThreadSelectors.getFilteredThread(state),
      maxStackDepth: selectedThreadSelectors.getCallNodeMaxDepthForFlameGraph(
        state
      ),
      flameGraphTiming: selectedThreadSelectors.getFlameGraphTiming(state),
      callTree: selectedThreadSelectors.getCallTree(state),
      timeRange: getCommittedRange(state),
      previewSelection: getPreviewSelection(state),
      callNodeInfo: selectedThreadSelectors.getCallNodeInfo(state),
      threadIndex: getSelectedThreadIndex(state),
      selectedCallNodeIndex: selectedThreadSelectors.getSelectedCallNodeIndex(
        state
      ),
      isCallNodeContextMenuVisible: getProfileViewOptions(state)
        .isCallNodeContextMenuVisible,
      scrollToSelectionGeneration: getScrollToSelectionGeneration(state),
      icons: getIconsWithClassNames(state),
    };
  },
  mapDispatchToProps: {
    changeSelectedCallNode,
  },
  component: FlameGraph,
};

export default explicitConnect(options);
