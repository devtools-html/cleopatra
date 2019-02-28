/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';

import explicitConnect from '../../utils/connect';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import { getSelectedThreadIndex } from '../../selectors/url-state';
import MarkerTooltipContents from '../shared/MarkerTooltipContents';

import type {
  ConnectedProps,
  ExplicitConnectOptions,
} from '../../utils/connect';
import type { ThreadIndex } from '../../types/profile';
import type { Marker } from '../../types/profile-derived';

type StateProps = {|
  +selectedThreadIndex: ThreadIndex,
  +marker: Marker | null,
|};

type Props = ConnectedProps<{||}, StateProps, {||}>;

class MarkerSidebar extends React.PureComponent<Props> {
  render() {
    const { marker, selectedThreadIndex } = this.props;

    if (marker === null) {
      return (
        <div className="sidebar sidebar-marker-table">
          Select a marker to display some information about it.
        </div>
      );
    }

    return (
      <aside className="sidebar sidebar-marker-table">
        <div className="sidebar-contents-wrapper">
          <MarkerTooltipContents
            marker={marker}
            threadIndex={selectedThreadIndex}
          />
        </div>
      </aside>
    );
  }
}

const options: ExplicitConnectOptions<{||}, StateProps, {||}> = {
  mapStateToProps: state => {
    const filteredMarkers = selectedThreadSelectors.getPreviewFilteredMarkers(
      state
    );
    const selectedMarkerIndex = selectedThreadSelectors.getSelectedMarkerIndex(
      state
    );
    return {
      marker:
        selectedMarkerIndex === null
          ? null
          : filteredMarkers[selectedMarkerIndex] || null,
      selectedThreadIndex: getSelectedThreadIndex(state),
    };
  },
  component: MarkerSidebar,
};

export default explicitConnect(options);
