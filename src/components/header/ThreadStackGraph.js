/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import React, { PureComponent, PropTypes } from 'react';
import classNames from 'classnames';
import { timeCode } from '../../utils/time-code';
import { getSampleFuncStacks } from '../../profile-logic/profile-data';

class ThreadStackGraph extends PureComponent {
  constructor(props) {
    super(props);
    this._resizeListener = () => this.forceUpdate();
    this._requestedAnimationFrame = false;
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMarkerSelected = this._onMarkerSelected.bind(this);
    this._canvas = null;
  }

  _scheduleDraw() {
    if (!this._requestedAnimationFrame) {
      this._requestedAnimationFrame = true;
      window.requestAnimationFrame(() => {
        this._requestedAnimationFrame = false;
        if (this._canvas) {
          timeCode('ThreadStackGraph render', () => {
            this.drawCanvas(this._canvas);
          });
        }
      });
    }
  }

  componentDidMount() {
    const win = this._canvas.ownerDocument.defaultView;
    win.addEventListener('resize', this._resizeListener);
    this.forceUpdate(); // for initial size
  }

  componentWillUnmount() {
    const win = this._canvas.ownerDocument.defaultView;
    win.removeEventListener('resize', this._resizeListener);
  }

  drawCanvas(c) {
    const {
      thread,
      interval,
      rangeStart,
      rangeEnd,
      funcStackInfo,
      selectedFuncStack,
    } = this.props;

    const devicePixelRatio = c.ownerDocument
      ? c.ownerDocument.defaultView.devicePixelRatio
      : 1;
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * devicePixelRatio);
    c.height = Math.round(r.height * devicePixelRatio);
    const ctx = c.getContext('2d');
    let maxDepth = 0;
    const { funcStackTable, stackIndexToFuncStackIndex } = funcStackInfo;
    const sampleFuncStacks = getSampleFuncStacks(
      thread.samples,
      stackIndexToFuncStackIndex
    );
    for (let i = 0; i < funcStackTable.depth.length; i++) {
      if (funcStackTable.depth[i] > maxDepth) {
        maxDepth = funcStackTable.depth[i];
      }
    }
    const range = [rangeStart, rangeEnd];
    const rangeLength = range[1] - range[0];
    const xPixelsPerMs = c.width / rangeLength;
    const yPixelsPerDepth = c.height / maxDepth;
    const trueIntervalPixelWidth = interval * xPixelsPerMs;
    const multiplier = trueIntervalPixelWidth < 2.0 ? 1.2 : 1.0;
    const drawnIntervalWidth = Math.max(
      0.8,
      trueIntervalPixelWidth * multiplier
    );
    let selectedFuncStackDepth = 0;
    if (selectedFuncStack !== -1 && selectedFuncStack !== null) {
      selectedFuncStackDepth = funcStackTable.depth[selectedFuncStack];
    }
    function hasSelectedFuncStackPrefix(funcStackPrefix) {
      let funcStack = funcStackPrefix;
      for (
        let depth = funcStackTable.depth[funcStack];
        depth > selectedFuncStackDepth;
        depth--
      ) {
        funcStack = funcStackTable.prefix[funcStack];
      }
      return funcStack === selectedFuncStack;
    }
    for (let i = 0; i < sampleFuncStacks.length; i++) {
      const sampleTime = thread.samples.time[i];
      if (
        sampleTime + drawnIntervalWidth / xPixelsPerMs < range[0] ||
        sampleTime > range[1]
      ) {
        continue;
      }
      const funcStack = sampleFuncStacks[i];
      const isHighlighted = hasSelectedFuncStackPrefix(funcStack);
      const sampleHeight = funcStackTable.depth[funcStack] * yPixelsPerDepth;
      const startY = c.height - sampleHeight;
      // const responsiveness = thread.samples.responsiveness[i];
      // const jankSeverity = Math.min(1, responsiveness / 100);
      ctx.fillStyle = isHighlighted ? '#38445f' : '#7990c8';
      ctx.fillRect(
        (sampleTime - range[0]) * xPixelsPerMs,
        startY,
        drawnIntervalWidth,
        sampleHeight
      );
    }
  }

  _onMouseUp(e) {
    if (this.props.onClick) {
      const { rangeStart, rangeEnd } = this.props;
      const r = this._canvas.getBoundingClientRect();

      const x = e.pageX - r.left;
      const time = rangeStart + x / r.width * (rangeEnd - rangeStart);
      this.props.onClick(time);
    }
  }

  _onMarkerSelected(markerIndex) {
    if (this.props.onMarkerSelect) {
      this.props.onMarkerSelect(markerIndex);
    }
    this.props.onClick();
  }

  render() {
    this._scheduleDraw();
    return (
      <div className={this.props.className}>
        <canvas
          className={classNames(
            `${this.props.className}Canvas`,
            'threadStackGraphCanvas'
          )}
          ref={ref => (this._canvas = ref)}
          onMouseUp={this._onMouseUp}
        />
      </div>
    );
  }
}

ThreadStackGraph.propTypes = {
  thread: PropTypes.shape({
    samples: PropTypes.object.isRequired,
  }).isRequired,
  interval: PropTypes.number.isRequired,
  rangeStart: PropTypes.number.isRequired,
  rangeEnd: PropTypes.number.isRequired,
  funcStackInfo: PropTypes.shape({
    funcStackTable: PropTypes.object.isRequired,
    stackIndexToFuncStackIndex: PropTypes.any.isRequired,
  }).isRequired,
  selectedFuncStack: PropTypes.number,
  className: PropTypes.string,
  onClick: PropTypes.func,
  onMarkerSelect: PropTypes.func,
};

export default ThreadStackGraph;
