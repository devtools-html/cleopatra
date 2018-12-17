/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import VirtualList from './VirtualList';
import { BackgroundImageStyleDef } from './StyleDef';

import ContextMenuTrigger from './ContextMenuTrigger';

import type { IconWithClassName } from '../../types/state';
import type { CssPixels } from '../../types/units';

/**
 * This number is used to decide how many lines the selection moves when the
 * user presses PageUp or PageDown.
 * It's big enough to be useful, but small enough to always be less than one
 * window. Of course the correct number should depend on the height of the
 * viewport, but this is more complex, and an hardcoded number is good enough in
 * this case.
 */
const PAGE_KEYS_DELTA = 15;

// This is used for the result of RegExp.prototype.exec because Flow doesn't do it.
// See https://github.com/facebook/flow/issues/4099
type RegExpResult = null | ({ index: number, input: string } & string[]);
type NodeIndex = number;

export type Column = {
  propName: string,
  title: string,
  component?: React.ComponentType<*>,
};

type TreeViewHeaderProps = {|
  +fixedColumns: Column[],
  +mainColumn: Column,
|};

const TreeViewHeader = ({ fixedColumns, mainColumn }: TreeViewHeaderProps) => {
  if (fixedColumns.length === 0 && !mainColumn.title) {
    // If there is nothing to display in the header, do not render it.
    return null;
  }
  return (
    <div className="treeViewHeader">
      {fixedColumns.map(col => (
        <span
          className={`treeViewHeaderColumn treeViewFixedColumn ${col.propName}`}
          key={col.propName}
        >
          {col.title}
        </span>
      ))}
      <span
        className={`treeViewHeaderColumn treeViewMainColumn ${
          mainColumn.propName
        }`}
      >
        {mainColumn.title}
      </span>
    </div>
  );
};

function reactStringWithHighlightedSubstrings(
  string: string,
  regExp: RegExp | null,
  className: string
) {
  if (!regExp) {
    return string;
  }

  // Since the regexp is reused and likely global, let's make sure we reset it.
  regExp.lastIndex = 0;

  const highlighted = [];
  let lastOccurrence = 0;
  let result;
  while ((result = regExp.exec(string))) {
    const typedResult: RegExpResult = result;
    if (typedResult === null) {
      break;
    }
    highlighted.push(string.substring(lastOccurrence, typedResult.index));
    lastOccurrence = regExp.lastIndex;
    highlighted.push(
      <span key={typedResult.index} className={className}>
        {typedResult[0]}
      </span>
    );
  }
  highlighted.push(string.substring(lastOccurrence));
  return highlighted;
}

type TreeViewRowFixedColumnsProps<DisplayData: Object> = {|
  +displayData: DisplayData,
  +nodeId: NodeIndex,
  +columns: Column[],
  +index: number,
  +selected: boolean,
  +onClick: (NodeIndex, SyntheticMouseEvent<>) => mixed,
  +highlightRegExp: RegExp | null,
  +rowHeightStyle: { height: CssPixels, lineHeight: string },
|};

class TreeViewRowFixedColumns<DisplayData: Object> extends React.PureComponent<
  TreeViewRowFixedColumnsProps<DisplayData>
> {
  _onClick = (event: SyntheticMouseEvent<>) => {
    const { nodeId, onClick } = this.props;
    onClick(nodeId, event);
  };

  render() {
    const {
      displayData,
      columns,
      index,
      selected,
      highlightRegExp,
      rowHeightStyle,
    } = this.props;
    const evenOddClassName = index % 2 === 0 ? 'even' : 'odd';
    return (
      <div
        className={`treeViewRow treeViewRowFixedColumns ${evenOddClassName} ${
          selected ? 'selected' : ''
        }`}
        style={rowHeightStyle}
        onMouseDown={this._onClick}
      >
        {columns.map(col => {
          const RenderComponent = col.component;
          const text = displayData[col.propName] || '';

          return (
            <span
              className={`treeViewRowColumn treeViewFixedColumn ${
                col.propName
              }`}
              key={col.propName}
              title={text}
            >
              {RenderComponent ? (
                <RenderComponent displayData={displayData} />
              ) : (
                reactStringWithHighlightedSubstrings(
                  text,
                  highlightRegExp,
                  'treeViewHighlighting'
                )
              )}
            </span>
          );
        })}
      </div>
    );
  }
}

type TreeViewRowScrolledColumnsProps<DisplayData: Object> = {|
  +displayData: DisplayData,
  +nodeId: NodeIndex,
  +depth: number,
  +mainColumn: Column,
  +appendageColumn?: Column,
  +index: number,
  +canBeExpanded: boolean,
  +isExpanded: boolean,
  +selected: boolean,
  +onToggle: (NodeIndex, boolean, boolean) => mixed,
  +onClick: (NodeIndex, SyntheticMouseEvent<>) => mixed,
  +highlightRegExp: RegExp | null,
  // React converts height into 'px' values, while lineHeight is valid in
  // non-'px' units.
  +rowHeightStyle: { height: CssPixels, lineHeight: string },
  +indentWidth: CssPixels,
|};

class TreeViewRowScrolledColumns<
  DisplayData: Object
> extends React.PureComponent<TreeViewRowScrolledColumnsProps<DisplayData>> {
  /**
   * In this mousedown handler, we use event delegation so we have to use
   * `target` instead of `currentTarget`.
   */
  _onMouseDown = (
    event: { target: Element } & SyntheticMouseEvent<Element>
  ) => {
    const { nodeId, onClick } = this.props;
    if (!event.target.classList.contains('treeRowToggleButton')) {
      onClick(nodeId, event);
    }
  };

  _onToggleClick = (
    event: { target: Element } & SyntheticMouseEvent<Element>
  ) => {
    const { nodeId, isExpanded, onToggle } = this.props;
    onToggle(nodeId, !isExpanded, event.altKey === true);
  };

  render() {
    const {
      displayData,
      depth,
      mainColumn,
      appendageColumn,
      index,
      canBeExpanded,
      isExpanded,
      selected,
      highlightRegExp,
      rowHeightStyle,
      indentWidth,
    } = this.props;
    const evenOddClassName = index % 2 === 0 ? 'even' : 'odd';
    const RenderComponent = mainColumn.component;

    return (
      <div
        className={`treeViewRow treeViewRowScrolledColumns ${evenOddClassName} ${
          selected ? 'selected' : ''
        } ${displayData.dim ? 'dim' : ''}`}
        style={rowHeightStyle}
        onMouseDown={this._onMouseDown}
      >
        <span
          className="treeRowIndentSpacer"
          style={{ width: `${depth * indentWidth}px` }}
        />
        <span
          className={`treeRowToggleButton ${
            isExpanded ? 'expanded' : 'collapsed'
          } ${canBeExpanded ? 'canBeExpanded' : 'leaf'}`}
          onClick={this._onToggleClick}
        />
        <span
          className={`treeViewRowColumn treeViewMainColumn ${
            mainColumn.propName
          }`}
        >
          {displayData.categoryColor && displayData.categoryName ? (
            <span
              className={`treeViewCategoryKnob category-color-${
                displayData.categoryColor
              }`}
              title={displayData.categoryName}
            />
          ) : null}
          {RenderComponent ? (
            <RenderComponent displayData={displayData} />
          ) : (
            reactStringWithHighlightedSubstrings(
              displayData[mainColumn.propName],
              highlightRegExp,
              'treeViewHighlighting'
            )
          )}
        </span>
        {appendageColumn ? (
          <span
            className={`treeViewRowColumn treeViewAppendageColumn ${
              appendageColumn.propName
            }`}
          >
            {reactStringWithHighlightedSubstrings(
              displayData[appendageColumn.propName],
              highlightRegExp,
              'treeViewHighlighting'
            )}
          </span>
        ) : null}
      </div>
    );
  }
}

interface Tree<DisplayData: Object> {
  getDepth(NodeIndex): number;
  getRoots(): NodeIndex[];
  getDisplayData(NodeIndex): DisplayData;
  getParent(NodeIndex): NodeIndex;
  getChildren(NodeIndex): NodeIndex[];
  hasChildren(NodeIndex): boolean;
  getAllDescendants(NodeIndex): Set<NodeIndex>;
}

type TreeViewProps<DisplayData> = {|
  +fixedColumns: Column[],
  +mainColumn: Column,
  +tree: Tree<DisplayData>,
  +expandedNodeIds: Array<NodeIndex | null>,
  +selectedNodeId: NodeIndex | null,
  +onExpandedNodesChange: (Array<NodeIndex | null>) => mixed,
  +highlightRegExp?: RegExp | null,
  +appendageColumn?: Column,
  +disableOverscan?: boolean,
  +icons?: IconWithClassName[],
  +contextMenu?: React.Element<any>,
  +contextMenuId?: string,
  +maxNodeDepth: number,
  +onSelectionChange: NodeIndex => mixed,
  +onEnterKey?: NodeIndex => mixed,
  +rowHeight: CssPixels,
  +indentWidth: CssPixels,
|};

class TreeView<DisplayData: Object> extends React.PureComponent<
  TreeViewProps<DisplayData>
> {
  _specialItems: (NodeIndex | null)[];
  _visibleRows: NodeIndex[];
  _expandedNodes: Set<NodeIndex | null>;
  _list: VirtualList | null = null;
  _takeListRef = (list: VirtualList | null) => (this._list = list);

  constructor(props: TreeViewProps<DisplayData>) {
    super(props);
    this._specialItems = [props.selectedNodeId];
    this._expandedNodes = new Set(props.expandedNodeIds);
    this._visibleRows = this._getAllVisibleRows(props);
  }

  scrollSelectionIntoView() {
    const { selectedNodeId, tree } = this.props;
    if (this._list && selectedNodeId !== null) {
      const list = this._list; // this temp variable so that flow knows that it's non-null
      const rowIndex = this._visibleRows.indexOf(selectedNodeId);
      const depth = tree.getDepth(selectedNodeId);
      list.scrollItemIntoView(rowIndex, depth * 10);
    }
  }

  componentWillReceiveProps(nextProps: TreeViewProps<DisplayData>) {
    if (nextProps.selectedNodeId !== this.props.selectedNodeId) {
      this._specialItems = [nextProps.selectedNodeId];
    }
    if (
      nextProps.tree !== this.props.tree ||
      nextProps.expandedNodeIds !== this.props.expandedNodeIds
    ) {
      this._expandedNodes = new Set(nextProps.expandedNodeIds);
      this._visibleRows = this._getAllVisibleRows(nextProps);
    }
  }

  _renderRow = (nodeId: NodeIndex, index: number, columnIndex: number) => {
    const {
      tree,
      fixedColumns,
      mainColumn,
      appendageColumn,
      selectedNodeId,
      highlightRegExp,
      rowHeight,
      indentWidth,
    } = this.props;
    const displayData = tree.getDisplayData(nodeId);
    // React converts height into 'px' values, while lineHeight is valid in
    // non-'px' units.
    const rowHeightStyle = { height: rowHeight, lineHeight: `${rowHeight}px` };

    if (columnIndex === 0) {
      return (
        <TreeViewRowFixedColumns
          displayData={displayData}
          columns={fixedColumns}
          nodeId={nodeId}
          index={index}
          selected={nodeId === selectedNodeId}
          onClick={this._onRowClicked}
          highlightRegExp={highlightRegExp || null}
          rowHeightStyle={rowHeightStyle}
        />
      );
    }
    const canBeExpanded = tree.hasChildren(nodeId);
    const isExpanded = !this._isCollapsed(nodeId);
    return (
      <TreeViewRowScrolledColumns
        rowHeightStyle={rowHeightStyle}
        displayData={displayData}
        mainColumn={mainColumn}
        appendageColumn={appendageColumn}
        depth={tree.getDepth(nodeId)}
        nodeId={nodeId}
        index={index}
        canBeExpanded={canBeExpanded}
        isExpanded={isExpanded}
        onToggle={this._toggle}
        selected={nodeId === selectedNodeId}
        onClick={this._onRowClicked}
        highlightRegExp={highlightRegExp || null}
        indentWidth={indentWidth}
      />
    );
  };

  _addVisibleRowsFromNode(
    props: TreeViewProps<DisplayData>,
    arr: NodeIndex[],
    nodeId: NodeIndex,
    depth: number
  ) {
    arr.push(nodeId);
    if (this._isCollapsed(nodeId)) {
      return;
    }
    const children = props.tree.getChildren(nodeId);
    for (let i = 0; i < children.length; i++) {
      this._addVisibleRowsFromNode(props, arr, children[i], depth + 1);
    }
  }

  _getAllVisibleRows(props: TreeViewProps<DisplayData>): NodeIndex[] {
    const roots = props.tree.getRoots();
    const allRows = [];
    for (let i = 0; i < roots.length; i++) {
      this._addVisibleRowsFromNode(props, allRows, roots[i], 0);
    }
    return allRows;
  }

  _isCollapsed(nodeId: NodeIndex): boolean {
    return !this._expandedNodes.has(nodeId);
  }

  _toggle = (
    nodeId: NodeIndex,
    newExpanded: boolean = this._isCollapsed(nodeId),
    toggleAll: * = false
  ) => {
    const newSet = new Set(this._expandedNodes);
    if (newExpanded) {
      newSet.add(nodeId);
      if (toggleAll) {
        for (const descendant of this.props.tree.getAllDescendants(nodeId)) {
          newSet.add(descendant);
        }
      }
    } else {
      newSet.delete(nodeId);
    }
    this.props.onExpandedNodesChange(Array.from(newSet.values()));
  };

  _toggleAll(
    nodeId: NodeIndex,
    newExpanded: boolean = this._isCollapsed(nodeId)
  ) {
    this._toggle(nodeId, newExpanded, true);
  }

  _select(nodeId: NodeIndex) {
    this.props.onSelectionChange(nodeId);
  }

  _onRowClicked = (nodeId: NodeIndex, event: SyntheticMouseEvent<>) => {
    this._select(nodeId);
    if (event.detail === 2 && event.button === 0) {
      // double click
      this._toggle(nodeId);
    }
  };

  /**
   * Flow doesn't yet know about Clipboard events, so infer what's going on with the
   * event.
   * See: https://github.com/facebook/flow/issues/1856
   */
  _onCopy = (event: *) => {
    event.preventDefault();
    const { tree, selectedNodeId, mainColumn } = this.props;
    if (selectedNodeId) {
      const displayData = tree.getDisplayData(selectedNodeId);
      const clipboardData: DataTransfer = (event: Object).clipboardData;
      clipboardData.setData('text/plain', displayData[mainColumn.propName]);
    }
  };

  _onKeyDown = (event: KeyboardEvent) => {
    const hasModifier = event.ctrlKey || event.altKey;
    const isNavigationKey =
      event.key.startsWith('Arrow') ||
      event.key.startsWith('Page') ||
      event.key === 'Home' ||
      event.key === 'End';
    const isAsteriskKey = event.key === '*';
    const isEnterKey = event.key === 'Enter';

    if (hasModifier || (!isNavigationKey && !isAsteriskKey && !isEnterKey)) {
      // No key events that we care about were found, so don't try and handle them.
      return;
    }
    event.stopPropagation();
    event.preventDefault();

    const selected = this.props.selectedNodeId;
    const visibleRows = this._getAllVisibleRows(this.props);
    const selectedRowIndex = visibleRows.findIndex(
      nodeId => nodeId === selected
    );

    if (selected === null || selectedRowIndex === -1) {
      // the first condition is redundant, but it makes flow happy
      this._select(visibleRows[0]);
      return;
    }

    if (isNavigationKey) {
      switch (event.key) {
        case 'ArrowUp': {
          if (event.metaKey) {
            // On MacOS this is a common shortcut for the Home gesture
            this._select(visibleRows[0]);
            break;
          }

          if (selectedRowIndex > 0) {
            this._select(visibleRows[selectedRowIndex - 1]);
          }
          break;
        }
        case 'ArrowDown': {
          if (event.metaKey) {
            // On MacOS this is a common shortcut for the End gesture
            this._select(visibleRows[visibleRows.length - 1]);
            break;
          }

          if (selectedRowIndex < visibleRows.length - 1) {
            this._select(visibleRows[selectedRowIndex + 1]);
          }
          break;
        }
        case 'PageUp': {
          if (selectedRowIndex > 0) {
            const nextRow = Math.max(0, selectedRowIndex - PAGE_KEYS_DELTA);
            this._select(visibleRows[nextRow]);
          }
          break;
        }
        case 'PageDown': {
          if (selectedRowIndex < visibleRows.length - 1) {
            const nextRow = Math.min(
              visibleRows.length - 1,
              selectedRowIndex + PAGE_KEYS_DELTA
            );
            this._select(visibleRows[nextRow]);
          }
          break;
        }
        case 'Home': {
          this._select(visibleRows[0]);
          break;
        }
        case 'End': {
          this._select(visibleRows[visibleRows.length - 1]);
          break;
        }
        case 'ArrowLeft': {
          const isCollapsed = this._isCollapsed(selected);
          if (!isCollapsed) {
            this._toggle(selected);
          } else {
            const parent = this.props.tree.getParent(selected);
            if (parent !== -1) {
              this._select(parent);
            }
          }
          break;
        }
        case 'ArrowRight': {
          const isCollapsed = this._isCollapsed(selected);
          if (isCollapsed) {
            this._toggle(selected);
          } else {
            // Do KEY_DOWN only if the next element is a child
            if (this.props.tree.hasChildren(selected)) {
              this._select(this.props.tree.getChildren(selected)[0]);
            }
          }
          break;
        }
        default:
          throw new Error('Unhandled navigation key.');
      }
    }

    if (isAsteriskKey) {
      this._toggleAll(selected);
    }

    if (isEnterKey) {
      const { onEnterKey, selectedNodeId } = this.props;
      if (onEnterKey && selectedNodeId !== null) {
        onEnterKey(selectedNodeId);
      }
    }
  };

  focus() {
    if (this._list) {
      this._list.focus();
    }
  }

  render() {
    const {
      fixedColumns,
      mainColumn,
      disableOverscan,
      contextMenu,
      contextMenuId,
      icons,
      maxNodeDepth,
      rowHeight,
    } = this.props;
    return (
      <div className="treeView">
        {icons &&
          icons.map(({ className, icon }) => (
            <BackgroundImageStyleDef
              className={className}
              url={icon}
              key={className}
            />
          ))}
        <TreeViewHeader fixedColumns={fixedColumns} mainColumn={mainColumn} />
        <ContextMenuTrigger
          id={contextMenuId}
          attributes={{ className: 'treeViewContextMenu' }}
        >
          <VirtualList
            className="treeViewBody"
            items={this._visibleRows}
            renderItem={this._renderRow}
            itemHeight={rowHeight}
            columnCount={2}
            focusable={true}
            onKeyDown={this._onKeyDown}
            specialItems={this._specialItems}
            disableOverscan={!!disableOverscan}
            onCopy={this._onCopy}
            // If there is a deep call node depth, expand the width, or else keep it
            // at 3000 wide.
            containerWidth={Math.max(3000, maxNodeDepth * 10 + 2000)}
            ref={this._takeListRef}
          />
        </ContextMenuTrigger>
        {contextMenu}
      </div>
    );
  }
}

export default TreeView;
