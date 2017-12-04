/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import React from 'react';
import { connect } from 'react-redux';
import IntervalMarkerOverview from './IntervalMarkerOverview';
import MarkerTooltipContents from '../shared/MarkerTooltipContents';
import { selectorsForThread } from '../../reducers/profile-view';
import {
  styles,
  overlayFills,
} from '../../profile-logic/interval-marker-styles';
import {
  getSelectedThreadIndex,
  getImplementationFilter,
} from '../../reducers/url-state';

export default connect((state, props) => {
  const { threadIndex } = props;
  const selectors = selectorsForThread(threadIndex);
  const selectedThread = getSelectedThreadIndex(state);
  const threadName = selectors.getFriendlyThreadName(state);
  const thread = selectors.getThread(state);
  const implementationFilter = getImplementationFilter(state);
  const intervalMarkers = selectors.getRangeSelectionFilteredTracingMarkersForHeader(
    state
  );
  const getTooltipContents = item => {
    return (
      <MarkerTooltipContents
        marker={item}
        threadName={threadName}
        thread={thread}
        implementationFilter={implementationFilter}
      />
    );
  };
  return {
    intervalMarkers,
    getTooltipContents,
    isSelected: threadIndex === selectedThread,
    threadIndex,
    styles,
    overlayFills,
  };
})(IntervalMarkerOverview);
