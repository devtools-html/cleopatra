// @flow
import React, { Component } from 'react';
import shallowCompare from 'react-addons-shallow-compare';
import { timeCode } from '../../common/time-code';
import TextMeasurement from '../../common/text-measurement';

import type { Thread } from '../../common/types/profile';
import type { Milliseconds, CssPixels, UnitIntervalOfProfileRange, DevicePixels } from '../../common/types/units';
import type { StackTimingByDepth } from '../stack-timing';

type Props = {
  thread: Thread,
  interval: Milliseconds,
  rangeStart: Milliseconds,
  rangeEnd: Milliseconds,
  className: string,
  containerWidth: CssPixels,
  containerHeight: CssPixels,
  viewportLeft: UnitIntervalOfProfileRange,
  viewportRight: UnitIntervalOfProfileRange,
  viewportTop: CssPixels,
  viewportBottom: CssPixels,
  stackTimingByDepth: StackTimingByDepth,
  rowHeight: CssPixels,
};

const ROW_HEIGHT = 16;
const TEXT_OFFSET_START = 3;
const TEXT_OFFSET_TOP = 11;

class FlameChartCanvas extends Component {

  _requestedAnimationFrame: boolean
  _devicePixelRatio: number
  _textMeasurement: null|TextMeasurement
  _ctx: null|CanvasRenderingContext2D

  constructor(props: Props) {
    super(props);
    this._requestedAnimationFrame = false;
    this._devicePixelRatio = 1;
    this._textMeasurement = null;
  }

  _scheduleDraw() {
    if (!this._requestedAnimationFrame) {
      this._requestedAnimationFrame = true;
      window.requestAnimationFrame(() => {
        this._requestedAnimationFrame = false;
        if (this.refs.canvas) {
          timeCode('FlameChartCanvas render', () => {
            this.drawCanvas();
          });
        }
      });
    }
  }

  shouldComponentUpdate(nextProps: Props) {
    return shallowCompare(this, nextProps);
  }

  componentDidMount() {
    this._textMeasurement = new TextMeasurement(this.refs.canvas.getContext('2d'));
  }

  _prepCanvas() {
    const {canvas} = this.refs;
    const {containerWidth, containerHeight} = this.props;
    const {devicePixelRatio} = window;
    const pixelWidth: DevicePixels = containerWidth * devicePixelRatio;
    const pixelHeight: DevicePixels = containerHeight * devicePixelRatio;
    if (!this._ctx) {
      this._ctx = canvas.getContext('2d');
    }
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      this._ctx.scale(this._devicePixelRatio, this._devicePixelRatio);
    }
    if (this._devicePixelRatio !== devicePixelRatio) {
      // Make sure and multiply by the inverse of the previous ratio, as the scaling
      // operates off of the previous set scale.
      const scale = (1 / this._devicePixelRatio) * devicePixelRatio;
      this._ctx.scale(scale, scale);
      this._devicePixelRatio = devicePixelRatio;
    }
    return this._ctx;
  }

  /**
   * Draw the canvas.
   *
   * Note that most of the units are not absolute values, but unit intervals ranged from
   * 0 - 1. This was done to make the calculations easier for computing various zoomed
   * and translated views independent of any particular scale. See FlameChartViewport.js
   * for a diagram detailing the various components of this set-up.
   * @param {HTMLCanvasElement} canvas - The current canvas.
   * @returns {undefined}
   */
  drawCanvas() {
    const { thread, rangeStart, rangeEnd, containerWidth,
            containerHeight, stackTimingByDepth, rowHeight,
            viewportLeft, viewportRight, viewportTop, viewportBottom } = this.props;

    const ctx = this._prepCanvas();
    ctx.clearRect(0, 0, containerWidth, containerHeight);

    const rangeLength: Milliseconds = rangeEnd - rangeStart;
    const viewportLength: UnitIntervalOfProfileRange = viewportRight - viewportLeft;

    // Convert CssPixels to Stack Depth
    const startDepth = Math.floor(viewportTop / rowHeight);
    const endDepth = Math.ceil(viewportBottom / rowHeight);

    // Only draw the stack frames that are vertically within view.
    for (let depth = startDepth; depth < endDepth; depth++) {
      // Get the timing information for a row of stack frames.
      const stackTiming = stackTimingByDepth[depth];

      if (!stackTiming) {
        continue;
      }
      /*
       * TODO - Do an O(log n) binary search to find the only samples in range rather than
       * linear O(n) search for loops. Profile the results to see if this helps at all.
       *
       * const startSampleIndex = binarySearch(stackTiming.start, rangeStart + rangeLength * viewportLeft);
       * const endSampleIndex = binarySearch(stackTiming.end, rangeStart + rangeLength * viewportRight);
       */

      // Decide which samples to actually draw
      const timeAtViewportLeft: Milliseconds = rangeStart + rangeLength * viewportLeft;
      const timeAtViewportRight: Milliseconds = rangeStart + rangeLength * viewportRight;

      for (let i = 0; i < stackTiming.length; i++) {
        // Only draw samples that are in bounds.
        if (stackTiming.end[i] > timeAtViewportLeft && stackTiming.start[i] < timeAtViewportRight) {
          const stackIndex = stackTiming.stack[i];
          let name, isJS, implementation;
          if (stackIndex === -1) {
            name = 'Platform';
            isJS = false;
          } else {
            const frameIndex = thread.stackTable.frame[stackIndex];
            const funcIndex = thread.frameTable.func[frameIndex];
            const implementationIndex = thread.frameTable.implementation[frameIndex];
            implementation = implementationIndex ? thread.stringTable.getString(implementationIndex) : null;
            name = thread.stringTable.getString(thread.funcTable.name[funcIndex]);
            isJS = thread.funcTable.isJS[funcIndex];
          }
          if (implementation) {
            ctx.fillStyle = implementation === 'baseline'
              // Baseline
              ? '#B5ECA8'
              // Ion (JIT)
              : '#3CCF55';
          } else {
            ctx.fillStyle = isJS
              // JS code
              ? 'rgb(200, 200, 200)'
              // Platform code
              : 'rgb(240, 240, 240)';
          }
          const startTime: UnitIntervalOfProfileRange = (stackTiming.start[i] - rangeStart) / rangeLength;
          const endTime: UnitIntervalOfProfileRange = (stackTiming.end[i] - rangeStart) / rangeLength;

          const x: CssPixels = ((startTime - viewportLeft) * containerWidth / viewportLength);
          const y: CssPixels = depth * ROW_HEIGHT - viewportTop;
          const w: CssPixels = ((endTime - startTime) * containerWidth / viewportLength);
          const h: CssPixels = ROW_HEIGHT - 1;

          if (w < 2) {
            // Skip sending draw calls for sufficiently small boxes.
            continue;
          }
          ctx.fillRect(x, y, w, h);
          // Ensure spacing between blocks.
          ctx.clearRect(x, y, 1, h);

          // TODO - L10N RTL.
          // Constrain the x coordinate to the leftmost area.
          const x2: CssPixels = Math.max(x, 0) + TEXT_OFFSET_START;
          const w2: CssPixels = Math.max(0, w - (x2 - x));

          if (this._textMeasurement !== null && w2 > this._textMeasurement.minWidth) {
            const text = this._textMeasurement.getFittedText(name, w2);
            if (text) {
              ctx.fillStyle = 'rgb(0, 0, 0)';
              ctx.fillText(text, x2, y + TEXT_OFFSET_TOP);
            }
          }
        }
      }
    }
  }

  render() {
    this._scheduleDraw();
    return <canvas className='flameChartCanvas' ref='canvas'/>;
  }
}

export default FlameChartCanvas;
