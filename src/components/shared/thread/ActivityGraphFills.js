/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow

import { bisectionRight } from 'firefox-profiler/utils/bisect';

import './ActivityGraph.css';

import type {
  IndexIntoSamplesTable,
  IndexIntoCategoryList,
  Thread,
  Milliseconds,
  DevicePixels,
  CssPixels,
} from 'firefox-profiler/types';
import type { HoveredPixelState } from './ActivityGraph';

/**
 * This type contains the values that were used to render the ThreadActivityGraph's React
 * component, plus the sizing of the DOM element. These values are computed BEFORE drawing
 * to the 2d canvas, and are needed to compute the 2d canvas' fills.
 *
 * Computing these fills requires a large set of mutable and immutable values. This type
 * helps organize and delineate these two types of values by only containing the
 * immutable values. This object makes it easy to share these values between different
 * classes and functions.
 */
type RenderedComponentSettings = {|
  +canvasPixelWidth: DevicePixels,
  +canvasPixelHeight: DevicePixels,
  +fullThread: Thread,
  +fullThreadSampleCategories: Uint8Array,
  +fullThreadSampleCPUPercentages: Uint8Array,
  +rangeFilteredThread: Thread,
  +interval: Milliseconds,
  +rangeStart: Milliseconds,
  +rangeEnd: Milliseconds,
  +sampleIndexOffset: number,
  +xPixelsPerMs: number,
  +treeOrderSampleComparator: ?(
    IndexIntoSamplesTable,
    IndexIntoSamplesTable
  ) => number,
  +greyCategoryIndex: IndexIntoCategoryList,
  +sampleSelectedStates: Uint8Array,
  +categoryDrawStyles: CategoryDrawStyles,
  +precomputedPositions: PrecomputedPositions,
|};

export type PrecomputedPositions = {|
  // The fractional device pixel position per sample in the range-filtered thread.
  // Each position is clamped such that 0 <= pos < canvasPixelWidth.
  samplePositions: Float32Array, // DevicePixel[]
  // The fractional device pixel position of the half-way point *before* the sample,
  // per sample in the range-filtered thread. Has one extra element at the end for
  // the half-way position after the last sample.
  // Each position is clamped such that 0 <= pos < canvasPixelWidth.
  halfwayPositions: Float32Array, // DevicePixel[]
|};

type SampleContributionToPixel = {|
  +sample: IndexIntoSamplesTable,
  +contribution: number,
|};

/**
 * The category fills are the computation that is ultimately returned for drawing
 * the categories to the canvas. During the computation step, this value is mutated
 * in place, but should be consumed immutably.
 */
type CategoryFill = {|
  +category: IndexIntoCategoryList,
  +fillStyle: string | CanvasPattern,
  // The Float32Arrays are mutated in place during the computation step.
  +perPixelContribution: Float32Array,
  +accumulatedUpperEdge: Float32Array,
|};

export type CategoryDrawStyles = $ReadOnlyArray<{|
  +category: number,
  +gravity: number,
  +selectedFillStyle: string,
  +unselectedFillStyle: string,
  +filteredOutByTransformFillStyle: CanvasPattern,
  +selectedTextColor: string,
|}>;

// These Float32Arrays are mutated in place during the computation step.
// buffers[selectedState] is the buffer for the given SelectedState.
type SelectedPercentageAtPixelBuffers = Float32Array[];

export type CpuRatioInTimeRange = {|
  +cpuRatio: number,
  +timeRange: Milliseconds,
|};

const BOX_BLUR_RADII = [3, 2, 2];
const SMOOTHING_RADIUS = 3 + 2 + 2;
const SMOOTHING_KERNEL: Float32Array = _getSmoothingKernel(
  SMOOTHING_RADIUS,
  BOX_BLUR_RADII
);

export function precomputePositions(
  fullThreadSampleTimes: Milliseconds[],
  sampleIndexOffset: number,
  sampleCount: number,
  rangeStart: Milliseconds,
  xPixelsPerMs: number,
  interval: Milliseconds,
  canvasPixelWidth: DevicePixels
): PrecomputedPositions {
  function convertTimeToClampedPosition(time: Milliseconds): DevicePixels {
    const pos = (time - rangeStart) * xPixelsPerMs;
    if (pos < 0) {
      return 0;
    }
    if (pos > canvasPixelWidth - 0.1) {
      return canvasPixelWidth - 0.1;
    }
    return pos;
  }

  // The fractional device pixel position per sample in the range-filtered thread.
  const samplePositions = new Float32Array(sampleCount); // DevicePixel[]

  // The fractional device pixel position of the half-way point *before* the sample,
  // per sample in the range-filtered thread. Has one extra element at the end for
  // the half-way position after the last sample.
  const halfwayPositions = new Float32Array(sampleCount + 1); // DevicePixel[]

  let previousSampleTime =
    sampleIndexOffset > 0
      ? fullThreadSampleTimes[sampleIndexOffset - 1]
      : fullThreadSampleTimes[0] - interval;
  // Go through the samples and accumulate the category into the percentageBuffers.
  for (let i = 0; i < sampleCount; i++) {
    const sampleTime = fullThreadSampleTimes[sampleIndexOffset + i];
    samplePositions[i] = convertTimeToClampedPosition(sampleTime);

    const halfwayPointTimeBefore = (previousSampleTime + sampleTime) / 2;
    halfwayPositions[i] = convertTimeToClampedPosition(halfwayPointTimeBefore);

    previousSampleTime = sampleTime;
  }

  // Add another half-way point for after the last sample.
  const afterLastSampleTime =
    sampleIndexOffset + sampleCount < fullThreadSampleTimes.length
      ? fullThreadSampleTimes[sampleIndexOffset + sampleCount]
      : previousSampleTime + interval;
  const halfwayPointTime = (previousSampleTime + afterLastSampleTime) / 2;
  halfwayPositions[sampleCount] =
    convertTimeToClampedPosition(halfwayPointTime);

  return {
    samplePositions,
    halfwayPositions,
  };
}

export function computeActivityGraphFills(
  renderedComponentSettings: RenderedComponentSettings
) {
  const mutablePercentageBuffers = _createSelectedPercentageAtPixelBuffers(
    renderedComponentSettings
  );
  const mutableFills = _getCategoryFills(
    renderedComponentSettings.categoryDrawStyles,
    mutablePercentageBuffers
  );
  const activityGraphFills = new ActivityGraphFillComputer(
    renderedComponentSettings,
    mutablePercentageBuffers,
    mutableFills
  );

  const { averageCPUPerPixel, upperGraphEdge } = activityGraphFills.run();
  // We're done mutating the fills' Float32Array buffers.
  const fills = mutableFills;

  return {
    fills,
    fillsQuerier: new ActivityFillGraphQuerier(
      renderedComponentSettings,
      fills,
      averageCPUPerPixel,
      upperGraphEdge
    ),
  };
}

/**
 * This class takes the immutable graph settings, and then computes the ActivityGraph's
 * fills by mutating the selected pecentage buffers and the category fill values.
 */
export class ActivityGraphFillComputer {
  +renderedComponentSettings: RenderedComponentSettings;
  // The fills and percentages are mutated in place.
  +mutablePercentageBuffers: SelectedPercentageAtPixelBuffers;
  +mutableFills: CategoryFill[];

  constructor(
    renderedComponentSettings: RenderedComponentSettings,
    mutablePercentageBuffers: SelectedPercentageAtPixelBuffers,
    mutableFills: CategoryFill[]
  ) {
    this.renderedComponentSettings = renderedComponentSettings;
    this.mutablePercentageBuffers = mutablePercentageBuffers;
    this.mutableFills = mutableFills;
  }

  /**
   * Run the computation to compute a list of the fills that need to be drawn for the
   * ThreadActivityGraph.
   */
  run(): {|
    +averageCPUPerPixel: Float32Array,
    +upperGraphEdge: Float32Array,
  |} {
    // First go through each sample, and set the buffers that contain the percentage
    // that a category contributes to a given place in the X axis of the chart.
    this._accumulateSampleCategories();

    // First get the average CPU in each pixel, and then accumulate the upper edge
    // of the graph after applying the blur.
    const averageCPUPerPixel = this._accumulateUpperEdge().slice();

    // Smooth the graphs by applying a 1D gaussian blur to the per-pixel
    // contribution of each fill.
    for (const fill of this.mutableFills) {
      _applyGaussianBlur1D(fill.perPixelContribution, BOX_BLUR_RADII);
    }

    const upperGraphEdge = this._accumulateUpperEdge();

    return { averageCPUPerPixel, upperGraphEdge };
  }

  /**
   * Accumulate the per pixel contribution of each fill, so that each fill's
   * accumulatedUpperEdge array describes the shape of the "upper edge" after this fill.
   * Fills are stacked on top of each other.
   */
  _accumulateUpperEdge(): Float32Array {
    const { mutableFills } = this;
    {
      // Only copy the first array, as there is no accumulation.
      const { accumulatedUpperEdge, perPixelContribution } = mutableFills[0];
      for (let i = 0; i < perPixelContribution.length; i++) {
        accumulatedUpperEdge[i] = perPixelContribution[i];
      }
    }

    // Now accumulate the upper edges.
    let previousUpperEdge = mutableFills[0].accumulatedUpperEdge;
    for (const {
      perPixelContribution,
      accumulatedUpperEdge,
    } of mutableFills.slice(1)) {
      for (let i = 0; i < perPixelContribution.length; i++) {
        accumulatedUpperEdge[i] =
          previousUpperEdge[i] + perPixelContribution[i];
      }
      previousUpperEdge = accumulatedUpperEdge;
    }

    return previousUpperEdge;
  }

  /**
   * Go through each sample, and apply its category percentages to the category
   * percentage buffers. These percentage buffers determine the overall percentage
   * that a category contributes to a single pixel. These buffers are mutated in place
   * with these methods.
   */
  _accumulateSampleCategories() {
    const { mutablePercentageBuffers, renderedComponentSettings } = this;
    const {
      fullThreadSampleCPUPercentages,
      fullThreadSampleCategories,
      rangeFilteredThread: { samples },
      sampleIndexOffset,
      sampleSelectedStates,
      precomputedPositions: { samplePositions, halfwayPositions },
    } = renderedComponentSettings;

    if (samples.length === 0) {
      // If we have no samples, there's nothing to do.
      return;
    }

    let halfwayPointPixelAfter = halfwayPositions[0];

    // A number between 0 and 1 for sample ratio. It changes depending on
    // the CPU usage per ms if it's given. If not, it uses 1 directly.
    let afterSampleCpuRatio =
      fullThreadSampleCPUPercentages[sampleIndexOffset] / 100;

    // Go through the samples and accumulate the category into the percentageBuffers.
    for (let i = 0; i < samples.length; i++) {
      const beforeSampleCpuRatio = afterSampleCpuRatio;
      afterSampleCpuRatio =
        fullThreadSampleCPUPercentages[sampleIndexOffset + i + 1] / 100;

      // Each sample contributes its category to the pixel interval created by
      // the halfway points with respect to the previous and next sample.
      const halfwayPointPixelBefore = halfwayPointPixelAfter;
      halfwayPointPixelAfter = halfwayPositions[i + 1];

      const selectedState = sampleSelectedStates[i];
      if (
        selectedState === 4 /* SelectedState.FilteredOutByActiveTab */ ||
        (beforeSampleCpuRatio === 0 && afterSampleCpuRatio === 0)
      ) {
        continue;
      }

      const category = fullThreadSampleCategories[sampleIndexOffset + i];
      const percentageBuffer =
        mutablePercentageBuffers[(category << 2) | selectedState];
      const samplePixel = samplePositions[i];

      // Samples have two parts to be able to present the different CPU usages properly.
      // This is because CPU usage number of a sample represents the CPU usage
      // starting starting from the previous sample time to this sample time.
      // These parts will be:
      // - Between `halfwayPointPixelBefore` and `samplePixel` with cpuRatio.
      // - Between `samplePixel` and `halfwayPointPixelAfter` with afterSampleCpuRatio.

      // Below we have two manually-inlined calls to _accumulateInBuffer.
      // Inlining them made a big difference for performance in Firefox.
      {
        const startPos = halfwayPointPixelBefore;
        const endPos = samplePixel;
        const cpuRatio = beforeSampleCpuRatio;

        const intStartPos = startPos | 0;
        const intEndPos = endPos | 0;

        if (intStartPos === intEndPos) {
          percentageBuffer[intStartPos] += cpuRatio * (endPos - startPos);
        } else {
          for (let i = intStartPos; i <= intEndPos; i++) {
            percentageBuffer[i] += cpuRatio;
          }

          // Subtract the partial pixels from start and end of the first part.
          percentageBuffer[intStartPos] -= cpuRatio * (startPos - intStartPos);
          percentageBuffer[intEndPos] -= cpuRatio * (1 - (endPos - intEndPos));
        }
      }
      {
        const startPos = samplePixel;
        const endPos = halfwayPointPixelAfter;
        const cpuRatio = afterSampleCpuRatio;

        const intStartPos = startPos | 0;
        const intEndPos = endPos | 0;

        if (intStartPos === intEndPos) {
          percentageBuffer[intStartPos] += cpuRatio * (endPos - startPos);
        } else {
          for (let i = intStartPos; i <= intEndPos; i++) {
            percentageBuffer[i] += cpuRatio;
          }

          // Subtract the partial pixels from start and end of the first part.
          percentageBuffer[intStartPos] -= cpuRatio * (startPos - intStartPos);
          percentageBuffer[intEndPos] -= cpuRatio * (1 - (endPos - intEndPos));
        }
      }
    }
  }
}

/**
 * This class contains the logic to pick a sample based on where the ThreaActivityGraph
 * was clicked. In this way, the fills can be computed one time, and the previously
 * computed settings can be re-used until the graph is drawn again.
 */
export class ActivityFillGraphQuerier {
  renderedComponentSettings: RenderedComponentSettings;
  fills: CategoryFill[];
  averageCPUPerPixel: Float32Array;
  upperGraphEdge: Float32Array;

  constructor(
    renderedComponentSettings: RenderedComponentSettings,
    fills: CategoryFill[],
    averageCPUPerPixel: Float32Array,
    upperGraphEdge: Float32Array
  ) {
    this.renderedComponentSettings = renderedComponentSettings;
    this.fills = fills;
    this.averageCPUPerPixel = averageCPUPerPixel;
    this.upperGraphEdge = upperGraphEdge;
  }

  /**
   * Given a click in CssPixels coordinates, look up the sample in the graph.
   */
  getSampleAndCpuRatioAtClick(
    cssX: CssPixels,
    cssY: CssPixels,
    time: Milliseconds
  ): HoveredPixelState | null {
    const {
      rangeFilteredThread: { samples, stackTable },
      canvasPixelWidth,
      canvasPixelHeight,
    } = this.renderedComponentSettings;

    const { devicePixelRatio } = window;
    const deviceX = Math.floor(cssX * devicePixelRatio);
    const deviceY = Math.floor(cssY * devicePixelRatio);

    if (
      deviceX < 0 ||
      deviceX >= canvasPixelWidth ||
      deviceY < 0 ||
      deviceY >= canvasPixelHeight
    ) {
      return null;
    }

    const categoryUnderMouse = this._categoryAtDevicePixel(deviceX, deviceY);

    const candidateSamples = this._getSamplesAtTime(time);
    const cpuRatioInTimeRange = this._getCPURatioAtX(deviceX, candidateSamples);

    if (categoryUnderMouse === null) {
      if (cpuRatioInTimeRange === null) {
        // If there is not CPU ratio values in that time range, do not show the tooltip.
        return null;
      }
      // Show only the CPU ratio in the tooltip.
      return { sample: null, cpuRatioInTimeRange };
    }

    // Get all samples that contribute pixels to the clicked category in this
    // pixel column of the graph.
    const { category, categoryLowerEdge, yPercentage } = categoryUnderMouse;

    // The candidate samples are sorted by gravity, bottom to top.
    // Each sample occupies a non-empty subrange of the [0, 1] range. The height
    // of each sample's range is called "contribution" here. The sample ranges are
    // directly adjacent, there's no space between them.
    // yPercentage is the mouse position converted to the [0, 1] range. We want
    // to find the sample whose range contains that yPercentage value.
    // Since we already filtered the contributing samples by the clicked
    // category, we start stacking up their contributions onto the lower edge
    // of that category's fill.
    let upperEdgeOfPreviousSample = categoryLowerEdge;
    // Loop invariant: yPercentage >= upperEdgeOfPreviousSample.
    // (In fact, yPercentage > upperEdgeOfPreviousSample except during the first
    // iteration - in the first iteration, yPercentage can be == categoryLowerEdge.)
    for (const { sample, contribution } of candidateSamples) {
      const stackIndex = samples.stack[sample];
      if (stackIndex === null) {
        console.error(
          `Stack index was null for sample index ${sample}, this shouldn't happen normally, please fix your source of data.`
        );
        continue;
      }
      const sampleCategory = stackTable.category[stackIndex];
      const upperEdgeOfThisSample = upperEdgeOfPreviousSample + contribution;
      // Checking the sample category here because there are samples with different
      // categories that has y percentage is lower than the upperEdgeOfThisSample.
      // It's possible to pick the wrong value otherwise.
      if (sampleCategory === category && yPercentage <= upperEdgeOfThisSample) {
        // We use <= rather than < here so that we don't return null if
        // yPercentage is equal to the upper edge of the last sample.
        return { sample, cpuRatioInTimeRange };
      }
      upperEdgeOfPreviousSample = upperEdgeOfThisSample;
    }

    return null;
  }

  /**
   * Determine the CPU usage ratio and the time range that contributes to this
   * ratio at that X. `upperGraphEdge` is the array we use to determine the CPU
   * ratio because this is the height of the whole activity graph, and it's a
   * number between 0 and 1 which is perfect for being used to determine the
   * percentage of the average CPU usage.
   */
  _getCPURatioAtX(
    deviceX: DevicePixels,
    samplesAtThisPixel: $ReadOnlyArray<SampleContributionToPixel>
  ): CpuRatioInTimeRange | null {
    const {
      rangeFilteredThread: { samples },
      interval,
    } = this.renderedComponentSettings;

    if (samplesAtThisPixel.length === 0) {
      // Return null if there are no candidate samples.
      return null;
    }

    const threadCPUDelta = samples.threadCPUDelta;
    if (!threadCPUDelta) {
      // There is no threadCPUDelta information in the array. Return null.
      return null;
    }

    const cpuRatio = this.averageCPUPerPixel[deviceX];

    // Get the time range of the contributed samples to the average CPU usage value.
    let timeRange = 0;
    for (const { sample } of samplesAtThisPixel) {
      timeRange +=
        sample === 0
          ? interval
          : samples.time[sample] - samples.time[sample - 1];
    }

    return { cpuRatio, timeRange };
  }

  /**
   * Find a specific category at a pixel location.
   * devicePixelY == 0 is the upper edge of the canvas,
   * devicePixelY == this.renderedComponentSettings.canvasPixelHeight is the
   * lower edge of the canvas.
   *
   * Returns a category such that categoryLowerEdge <= yPercentage and the next
   * category's lower edge would be > yPercentage.
   */
  _categoryAtDevicePixel(
    deviceX: DevicePixels,
    deviceY: DevicePixels
  ): null | {
    category: IndexIntoCategoryList,
    categoryLowerEdge: number,
    yPercentage: number,
  } {
    const { canvasPixelHeight } = this.renderedComponentSettings;

    // Convert the device pixel position into the range [0, 1], with 0 being
    // the *lower* edge of the canvas.
    const yPercentage = 1 - deviceY / canvasPixelHeight;

    let currentCategory = null;
    let currentCategoryStart = 0.0;
    let previousFillEnd = 0.0;

    // Find a fill such that yPercentage is between the fill's lower and its
    // upper edge. (The lower edge of a fill is given by the upper edge of the
    // previous fill. The first fill's lower edge is zero, i.e. the bottom edge
    // of the canvas.)
    // For each category, multiple fills can be present. All fills of the same
    // category will be consecutive in the fills array. See _getCategoryFills
    // for the full list.
    // Loop invariant: yPercentage >= previousFillEnd.
    // (In fact, yPercentage > previousFillEnd once we have encountered the first
    // non-empty fill. Before that, yPercentage can be == previousFillEnd, if
    // both are zero.)
    for (const { category, accumulatedUpperEdge } of this.fills) {
      const fillEnd = accumulatedUpperEdge[deviceX];

      if (category !== currentCategory) {
        currentCategory = category;
        currentCategoryStart = previousFillEnd;
      }

      if (fillEnd === previousFillEnd) {
        continue; // Ignore empty fills
      }

      if (yPercentage <= fillEnd) {
        // We use <= rather than < here so that we don't return null if
        // yPercentage is equal to the upper edge of the last fill.
        return {
          category,
          categoryLowerEdge: currentCategoryStart,
          yPercentage,
        };
      }

      previousFillEnd = fillEnd;
    }

    return null;
  }

  /**
   * Determine which samples contributed to a given height at a specific time. The result
   * is an array of all candidate samples, with their contribution amount.
   */
  _getSamplesAtTime(
    time: Milliseconds
  ): $ReadOnlyArray<SampleContributionToPixel> {
    const { rangeStart, treeOrderSampleComparator, xPixelsPerMs } =
      this.renderedComponentSettings;

    const xPixel = ((time - rangeStart) * xPixelsPerMs) | 0;
    const [sampleRangeStart, sampleRangeEnd] =
      this._getSampleRangeContributingToPixelWhenSmoothed(xPixel);

    const sampleContributions = [];
    for (let sample = sampleRangeStart; sample < sampleRangeEnd; sample++) {
      const contribution = this._getSmoothedContributionFromSampleToPixel(
        xPixel,
        sample
      );
      if (contribution > 0) {
        sampleContributions.push({
          sample,
          contribution,
        });
      }
    }
    if (treeOrderSampleComparator) {
      sampleContributions.sort((a, b) => {
        const sampleA = a.sample;
        const sampleB = b.sample;
        return treeOrderSampleComparator(sampleA, sampleB);
      });
    }
    return sampleContributions;
  }

  /**
   * Apply the smoothing to a pixel position to determine the start and end time range
   * that could affect that pixel.
   */
  _getSampleRangeContributingToPixelWhenSmoothed(
    xPixel: number
  ): [IndexIntoSamplesTable, IndexIntoSamplesTable] {
    const {
      rangeFilteredThread: { samples },
      rangeStart,
      xPixelsPerMs,
    } = this.renderedComponentSettings;
    const contributionTimeRangeStart =
      rangeStart + (xPixel - SMOOTHING_RADIUS) / xPixelsPerMs;
    const contributionTimeRangeEnd =
      rangeStart + (xPixel + SMOOTHING_RADIUS) / xPixelsPerMs;

    // Now find the samples where the range [mid(previousSample.time, thisSample.time), mid(thisSample.time, nextSample.time)]
    // overlaps with contributionTimeRange.
    const firstSampleAfterContributionTimeRangeStart = bisectionRight(
      samples.time,
      contributionTimeRangeStart
    );
    const firstSampleAfterContributionTimeRangeEnd = bisectionRight(
      samples.time,
      contributionTimeRangeEnd
    );
    return [
      Math.max(0, firstSampleAfterContributionTimeRangeStart - 1),
      Math.min(samples.length - 1, firstSampleAfterContributionTimeRangeEnd) +
        1,
    ];
  }

  /**
   * Compute how much a sample contributes to a given pixel after smoothing has
   * been applied.
   */
  _getSmoothedContributionFromSampleToPixel(
    xPixel: number,
    sample: IndexIntoSamplesTable
  ): number {
    const {
      rangeFilteredThread: { samples },
      interval,
      sampleIndexOffset,
      fullThread,
      fullThreadSampleCPUPercentages,
      xPixelsPerMs,
      rangeStart,
    } = this.renderedComponentSettings;
    const kernelLength = SMOOTHING_KERNEL.length;
    const kernelPos = xPixel - SMOOTHING_RADIUS;
    const pixelsAroundX = new Float32Array(kernelLength);
    const sampleTime = samples.time[sample];
    // Use the fullThread here to properly get the next and previous in case zoomed in.
    const fullThreadSample = sample + sampleIndexOffset;
    const prevSampleTime =
      fullThreadSample > 0
        ? fullThread.samples.time[fullThreadSample - 1]
        : sampleTime - interval;
    const nextSampleTime =
      fullThreadSample + 1 < fullThread.samples.length
        ? fullThread.samples.time[fullThreadSample + 1]
        : sampleTime + interval;

    const sampleTimeDeltaBefore = sampleTime - prevSampleTime;
    const cpuRatio = fullThreadSampleCPUPercentages[fullThreadSample] / 100;
    const afterSampleCpuRatio =
      fullThreadSampleCPUPercentages[fullThreadSample + 1] / 100;

    const kernelRangeStartTime = rangeStart + kernelPos / xPixelsPerMs;

    const halfwayPointTimeBefore = prevSampleTime + sampleTimeDeltaBefore / 2;
    let halfwayPointPixelBefore =
      (halfwayPointTimeBefore - kernelRangeStartTime) * xPixelsPerMs;
    if (halfwayPointPixelBefore < 0) {
      halfwayPointPixelBefore = 0;
    }
    if (halfwayPointPixelBefore >= kernelLength) {
      halfwayPointPixelBefore = kernelLength - 0.1;
    }
    let samplePixel = (sampleTime - kernelRangeStartTime) * xPixelsPerMs;
    if (samplePixel < 0) {
      samplePixel = 0;
    }
    if (samplePixel >= kernelLength) {
      samplePixel = kernelLength - 0.1;
    }
    const sampleTimeDeltaAfter = nextSampleTime - sampleTime;
    const halfwayPointTimeAfter = sampleTime + sampleTimeDeltaAfter / 2;
    let halfwayPointPixelAfter =
      (halfwayPointTimeAfter - kernelRangeStartTime) * xPixelsPerMs;
    if (halfwayPointPixelAfter < 0) {
      halfwayPointPixelAfter = 0;
    }
    if (halfwayPointPixelAfter >= kernelLength) {
      halfwayPointPixelAfter = kernelLength - 0.1;
    }

    _accumulateInBuffer(
      pixelsAroundX,
      halfwayPointPixelBefore,
      samplePixel,
      cpuRatio
    );
    _accumulateInBuffer(
      pixelsAroundX,
      samplePixel,
      halfwayPointPixelAfter,
      afterSampleCpuRatio
    );

    let sum = 0;
    for (let i = 0; i < SMOOTHING_KERNEL.length; i++) {
      sum += SMOOTHING_KERNEL[i] * pixelsAroundX[i];
    }

    return sum;
  }
}

/**
 * Get a smoothing kernel. This is a list of values ranged from 0 to 1 that are
 * smoothed by a gaussian blur.
 */
function _getSmoothingKernel(
  smoothingRadius: number,
  boxBlurRadii: number[]
): Float32Array {
  const kernelWidth = smoothingRadius + 1 + smoothingRadius;
  const kernel = new Float32Array(kernelWidth);
  kernel[smoothingRadius] = 1;
  _applyGaussianBlur1D(kernel, boxBlurRadii);
  return kernel;
}

/**
 * Create the buffers that hold the percentage of a category at a given device pixel.
 * These buffers can only be used once per fill computation. The buffer values are
 * updated across various method calls.
 */
function _createSelectedPercentageAtPixelBuffers({
  categoryDrawStyles,
  canvasPixelWidth,
}): SelectedPercentageAtPixelBuffers {
  const buffers = new Array(categoryDrawStyles.length * 4);
  const w = canvasPixelWidth;
  for (let i = 0; i < categoryDrawStyles.length; i++) {
    const bi = i << 2;
    buffers[bi | 0 /* SelectedState.Selected */] = new Float32Array(w);
    buffers[bi | 1 /* SelectedState.BeforeSelected */] = new Float32Array(w);
    buffers[bi | 2 /* SelectedState.AfterSelected */] = new Float32Array(w);
    buffers[bi | 3 /* SelectedState.FilteredOutByTransform */] =
      new Float32Array(w);
    // No entry for SelectedState.FilteredOutByActiveTab!
  }
  return buffers;
}

/**
 * For each category, create a fill style for each of 4 draw states. These fill styles
 * are sorted by their gravity.
 *
 * SelectedState.BeforeSelected,
 * SelectedState.Selected,
 * SelectedState.AfterSelected,
 * SelectedState.FilteredOutByTransform
 */
function _getCategoryFills(
  categoryDrawStyles: CategoryDrawStyles,
  percentageBuffers: SelectedPercentageAtPixelBuffers
): CategoryFill[] {
  // Sort all of the categories by their gravity.
  const categoryIndexesByGravity = categoryDrawStyles
    .map((_, i) => i)
    .sort(
      (a, b) => categoryDrawStyles[b].gravity - categoryDrawStyles[a].gravity
    );

  const nestedFills: CategoryFill[][] = categoryIndexesByGravity.map(
    (categoryIndex) => {
      const categoryDrawStyle = categoryDrawStyles[categoryIndex];
      const baseIndex = categoryIndex << 2;
      const sampleCount = percentageBuffers[0].length;
      // For every category we draw four fills, for the four selection kinds:
      return [
        {
          category: categoryDrawStyle.category,
          fillStyle: categoryDrawStyle.unselectedFillStyle,
          perPixelContribution:
            percentageBuffers[baseIndex | 1 /* SelectedState.BeforeSelected */],
          accumulatedUpperEdge: new Float32Array(sampleCount),
        },
        {
          category: categoryDrawStyle.category,
          fillStyle: categoryDrawStyle.selectedFillStyle,
          perPixelContribution:
            percentageBuffers[baseIndex | 0 /* SelectedState.Selected */],
          accumulatedUpperEdge: new Float32Array(sampleCount),
        },
        {
          category: categoryDrawStyle.category,
          fillStyle: categoryDrawStyle.unselectedFillStyle,
          perPixelContribution:
            percentageBuffers[baseIndex | 2 /* SelectedState.AfterSelected */],
          accumulatedUpperEdge: new Float32Array(sampleCount),
        },
        {
          category: categoryDrawStyle.category,
          fillStyle: categoryDrawStyle.filteredOutByTransformFillStyle,
          perPixelContribution:
            percentageBuffers[
              baseIndex | 3 /* SelectedState.FilteredOutByTransform */
            ],
          accumulatedUpperEdge: new Float32Array(sampleCount),
        },
      ];
    }
  );

  // Flatten out the fills into a single array.
  return [].concat(...nestedFills);
}

/**
 * Mutates `percentageBuffer` by adding contributions from a single fractional
 * pixel interval.
 */
function _accumulateInBuffer(
  percentageBuffer: Float32Array,
  startPos: DevicePixels,
  endPos: DevicePixels,
  cpuRatio: number
) {
  // We have a fractional interval which contributes to the graph's pixels.
  //
  // v       v       v       v       v       v       v       v       v
  // +-------+-------+-----+-+-------+-------+-----+-+-------+-------+
  // |       |       |     |///////////////////////| |       |       |
  // |       |       |     |///////////////////////| |       |       |
  // |       |       |     |///////////////////////| |       |       |
  // +-------+-------+-----+///////////////////////+-+-------+-------+
  //
  // We contribute this fractional interval to a device pixel array of
  // contributions, as follows: Fully overlapping pixels are
  // 1, and the partial overlapping pixels are the degree of overlap.
  //
  //                                 |
  //                                 v
  //
  // +-------+-------+-------+-------+-------+-------+-------+-------+
  // |       |       |       |///////////////+-------+       |       |
  // |       |       |       |///////////////////////|       |       |
  // |       |       +-------+///////////////////////|       |       |
  // +-------+-------+///////////////////////////////+-------+-------+

  const intStartPos = startPos | 0;
  const intEndPos = endPos | 0;

  if (intStartPos === intEndPos) {
    percentageBuffer[intStartPos] += cpuRatio * (endPos - startPos);
  } else {
    for (let i = intStartPos; i <= intEndPos; i++) {
      percentageBuffer[i] += cpuRatio;
    }

    // Subtract the partial pixels from start and end of the first part.
    percentageBuffer[intStartPos] -= cpuRatio * (startPos - intStartPos);
    percentageBuffer[intEndPos] -= cpuRatio * (1 - (endPos - intEndPos));
  }
}
/**
 * Apply a 1d box blur to a destination array.
 */
function _boxBlur1D(
  srcArray: Float32Array,
  destArray: Float32Array,
  radius: number
): void {
  if (srcArray.length < radius) {
    destArray.set(srcArray);
    return;
  }

  // We treat values outside the range as zero.
  let total = 0;
  for (let kx = 0; kx <= radius; ++kx) {
    total += srcArray[kx];
  }
  destArray[0] = total / (radius * 2 + 1);

  for (let x = 1; x < radius + 1; ++x) {
    total += srcArray[x + radius];
    destArray[x] = total / (radius * 2 + 1);
  }
  for (let x = radius + 1; x < srcArray.length - radius; ++x) {
    total -= srcArray[x - radius - 1];
    total += srcArray[x + radius];
    destArray[x] = total / (radius * 2 + 1);
  }
  for (let x = srcArray.length - radius; x < srcArray.length; ++x) {
    total -= srcArray[x - radius - 1];
    destArray[x] = total / (radius * 2 + 1);
  }
}

/**
 * Apply a blur with a gaussian distribution to a destination array.
 */
function _applyGaussianBlur1D(
  srcArray: Float32Array,
  boxBlurRadii: number[]
): void {
  let a = srcArray;
  let b = new Float32Array(srcArray.length);
  for (const radius of boxBlurRadii) {
    _boxBlur1D(a, b, radius);
    [b, a] = [a, b];
  }

  if (b === srcArray) {
    // The last blur was applied to the temporary array, blit the final values back
    // to the srcArray. This ensures that we are always mutating the values of the
    // src array, and not returning the newly created array.
    for (let i = 0; i < srcArray.length; i++) {
      srcArray[i] = a[i];
    }
  }
}
