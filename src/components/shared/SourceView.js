/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import * as React from 'react';
import classNames from 'classnames';
import memoize from 'memoize-one';
import range from 'array-range';

import { VirtualList } from './VirtualList';

import type { CssPixels, LineTimings } from 'firefox-profiler/types';

import './SourceView.css';

const SourceViewHeader = () => {
  return (
    <div className="sourceViewHeader">
      <span
        className="sourceViewHeaderColumn sourceViewFixedColumn total"
        title="The “total” sample count includes a summary of every sample where this
line was observed to be on the stack. This includes the time where the
line was actually running, and the time spent in the callers from this
line."
      >
        Total
      </span>
      <span
        className="sourceViewHeaderColumn sourceViewFixedColumn self"
        title="The “self” sample count only includes the samples where the line was
the end of the stack. If this line called into other functions,
then the “other” functions’ counts are not included. The “self” count is useful
for understanding where time was actually spent in a program."
      >
        Self
      </span>
      <span className="sourceViewHeaderColumn sourceViewFixedColumn lineNumber"></span>
      <span className="sourceViewHeaderColumn sourceViewMainColumn source"></span>
    </div>
  );
};

type SourceViewProps = {|
  +timings: LineTimings,
  +source: string,
  +rowHeight: CssPixels,
  +disableOverscan: boolean,
|};

type LineNumber = number;

function _mapGetKeyWithMaxValue<K>(map: Map<K, number>): K | void {
  let maxValue = -Infinity;
  let keyForMaxValue;
  for (const [key, value] of map) {
    if (value > maxValue) {
      maxValue = value;
      keyForMaxValue = key;
    }
  }
  return keyForMaxValue;
}

export class SourceView extends React.PureComponent<SourceViewProps> {
  _specialItems: [] = [];
  _list: VirtualList<LineNumber> | null = null;
  _takeListRef = (list: VirtualList<LineNumber> | null) => (this._list = list);

  _computeSourceLinesMemoized = memoize((source: string) => source.split('\n'));

  _computeAllLineNumbersMemoized = memoize(
    (sourceLines: string[], timings: LineTimings): number[] => {
      let maxLineNumber = sourceLines.length;
      if (maxLineNumber <= 1) {
        // We probably don't have the true source code yet, and don't really know
        // the true number of lines in this file.
        // Derive a maximum line number from the timings.
        // Add a bit of space at the bottom (10 rows) so that the scroll position
        // isn't too constrained - if the last known line is chosen as the "hot spot",
        // this extra space allows us to display it in the top half of the viewport,
        // if the viewport is small enough.
        maxLineNumber = Math.max(1, ...timings.totalLineHits.keys()) + 10;
      }
      return range(1, maxLineNumber + 1);
    }
  );

  _computeMaxLineLengthMemoized = memoize((sourceLines: string[]): number =>
    sourceLines.reduce(
      (prevMaxLen, line) => Math.max(prevMaxLen, line.length),
      0
    )
  );

  _renderRow = (lineNumber: LineNumber, index: number, columnIndex: number) => {
    const { rowHeight, timings } = this.props;
    // React converts height into 'px' values, while lineHeight is valid in
    // non-'px' units.
    const rowHeightStyle = { height: rowHeight, lineHeight: `${rowHeight}px` };

    const total = timings.totalLineHits.get(lineNumber);
    const self = timings.selfLineHits.get(lineNumber);
    const isNonZero = !!total || !!self;

    if (columnIndex === 0) {
      return (
        <div
          className={classNames('sourceViewRow', 'sourceViewRowFixedColumns', {
            sourceViewRowNonZero: isNonZero,
          })}
          style={rowHeightStyle}
        >
          <span className="sourceViewRowColumn sourceViewFixedColumn total">
            {total}
          </span>
          <span className="sourceViewRowColumn sourceViewFixedColumn self">
            {self}
          </span>
          <span className="sourceViewRowColumn sourceViewFixedColumn lineNumber">
            {lineNumber}
          </span>
        </div>
      );
    }

    const sourceLines = this._getSourceLines();
    const line = index < sourceLines.length ? sourceLines[index] : '';

    return (
      <div
        className={classNames('sourceViewRow', 'sourceViewRowScrolledColumns', {
          sourceViewRowNonZero: isNonZero,
        })}
        style={rowHeightStyle}
        key={index}
      >
        <code>{line}</code>
      </div>
    );
  };

  _getSourceLines(): string[] {
    return this._computeSourceLinesMemoized(this.props.source);
  }

  _getItems(): LineNumber[] {
    const { timings } = this.props;
    return this._computeAllLineNumbersMemoized(this._getSourceLines(), timings);
  }

  /**
   * Scroll to the line with the most hits, based on the timings in
   * timingsForScrolling.
   *
   * How is timingsForScrolling different from this.props.timings?
   * In the current implementation, this.props.timings are always the "global"
   * timings, i.e. they show the line hits for all samples in the current view,
   * regardless of the selected call node. However, when opening the source
   * view from a specific call node, you really want to see the code that's
   * relevant to that specific call node, or at least that specific function.
   * So timingsForScrolling are the timings that indicate just the line hits
   * in the selected call node. This means that the "hotspot" will be somewhere
   * in the selected function, and it will even be in the line that's most
   * relevant to that specific call node.
   *
   * Sometimes, timingsForScrolling can be completely empty. This happens, for
   * example, when the source view is showing a different file than the
   * selected call node's function's file, for example because we just loaded
   * from a URL and ended up with an arbitrary selected call node.
   * In that case, pick the hotspot from the global line timings.
   */
  /* This method is used by users of this component. */
  /* eslint-disable-next-line react/no-unused-class-component-methods */
  scrollToHotSpot(timingsForScrolling: LineTimings) {
    const heaviestLine =
      _mapGetKeyWithMaxValue(timingsForScrolling.totalLineHits) ??
      _mapGetKeyWithMaxValue(this.props.timings.totalLineHits);
    if (heaviestLine !== undefined) {
      this._scrollToLine(heaviestLine - 5);
    }
  }

  _scrollToLine(lineNumber: number) {
    if (this._list) {
      this._list.scrollToItem(lineNumber - 1, 0);
    }
  }

  render() {
    const { rowHeight, disableOverscan } = this.props;
    const sourceLines = this._getSourceLines();
    const maxLength = this._computeMaxLineLengthMemoized(sourceLines);
    const CHAR_WIDTH_ESTIMATE = 8; // css pixels

    return (
      <div className="sourceView">
        <SourceViewHeader />
        <VirtualList
          className="sourceViewBody"
          items={this._getItems()}
          renderItem={this._renderRow}
          itemHeight={rowHeight}
          columnCount={2}
          focusable={true}
          specialItems={this._specialItems}
          disableOverscan={disableOverscan}
          containerWidth={maxLength * CHAR_WIDTH_ESTIMATE}
          ref={this._takeListRef}
        />
      </div>
    );
  }
}
