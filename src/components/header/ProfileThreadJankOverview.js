/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import explicitConnect from '../../utils/connect';
import IntervalMarkerOverview from './IntervalMarkerOverview';
import { selectorsForThread } from '../../reducers/profile-view';
import {
  styles,
  overlayFills,
} from '../../profile-logic/interval-marker-styles';
import { getSelectedThreadIndex } from '../../reducers/url-state';

import type { ExplicitConnectOptions } from '../../utils/connect';
import type { StateProps, OwnProps } from './IntervalMarkerOverview';

const options: ExplicitConnectOptions<OwnProps, StateProps, {||}> = {
  mapStateToProps: (state, props) => {
    const { threadIndex } = props;
    const selectors = selectorsForThread(threadIndex);
    const threadName = selectors.getFriendlyThreadName(state);
    const selectedThread = getSelectedThreadIndex(state);
    return {
      intervalMarkers: selectors.getJankInstances(state),
      isSelected: threadIndex === selectedThread,
      threadName,
      styles,
      overlayFills,
    };
  },
  component: IntervalMarkerOverview,
};
export default explicitConnect(options);
