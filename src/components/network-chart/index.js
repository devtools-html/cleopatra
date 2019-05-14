/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { oneLine } from 'common-tags';
import * as React from 'react';
import explicitConnect from '../../utils/connect';
import NetworkSettings from '../shared/NetworkSettings';
import VirtualList from '../shared/VirtualList';
import { withSize } from '../shared/WithSize';
import NetworkChartEmptyReasons from './NetworkChartEmptyReasons';
import NetworkChartRow from './NetworkChartRow';

import {
  getPreviewSelection,
  getPreviewSelectionRange,
} from '../../selectors/profile';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import { getSelectedThreadIndex } from '../../selectors/url-state';
import { updatePreviewSelection } from '../../actions/profile-view';

import type { SizeProps } from '../shared/WithSize';
import type { NetworkPayload } from '../../types/markers';
import type { Marker, MarkerIndex } from '../../types/profile-derived';
import type { StartEndRange } from '../../types/units';
import type { ConnectedProps } from '../../utils/connect';

require('./index.css');

const ROW_HEIGHT = 16;

// The SizeProps are injected by the WithSize higher order component.
type DispatchProps = {|
  +updatePreviewSelection: typeof updatePreviewSelection,
|};

type StateProps = {|
  +markerIndexes: MarkerIndex[],
  +getMarker: MarkerIndex => Marker,
  +disableOverscan: boolean,
  +timeRange: StartEndRange,
  +threadIndex: number,
|};

type OwnProps = {| ...SizeProps |};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps>;

class NetworkChart extends React.PureComponent<Props> {
  // This isn't used at the moment, but we need a fixed instance so that a
  // rerender isn't triggered in VirtualList.
  _specialItems = [];

  _onCopy = (_event: Event) => {
    // Not implemented.
  };

  _onKeyDown = (_event: KeyboardEvent) => {
    // Not implemented.
  };

  _renderRow = (markerIndex: MarkerIndex, index: number): React.Node => {
    const { threadIndex, getMarker, timeRange, width } = this.props;
    const marker = getMarker(markerIndex);

    // Since our type definition for Marker can't refine to just Network
    // markers, extract the payload using an utility function.
    const networkPayload = _getNetworkPayloadOrNull(marker);
    if (networkPayload === null) {
      throw new Error(
        oneLine`
          The NetworkChart is supposed to only receive Network markers, but some other
          kind of marker payload was passed in.
        `
      );
    }

    return (
      <NetworkChartRow
        index={index}
        marker={marker}
        networkPayload={networkPayload}
        threadIndex={threadIndex}
        timeRange={timeRange}
        width={width}
      />
    );
  };

  render() {
    const { markerIndexes, width, timeRange, disableOverscan } = this.props;

    // We want to force a full rerender whenever the width or the range changes.
    // We compute a string using these values, so that when one of the value
    // changes the string changes and forces a rerender of the whole
    // VirtualList. See also the comments around this value in the VirtualList
    // component definition file.
    const forceRenderKey = `${timeRange.start}-${timeRange.end}-${width}`;

    return (
      <div
        className="networkChart"
        id="network-chart-tab"
        role="tabpanel"
        aria-labelledby="network-chart-tab-button"
      >
        <NetworkSettings />
        {markerIndexes.length === 0 ? (
          <NetworkChartEmptyReasons />
        ) : (
          <VirtualList
            className="treeViewBody"
            items={markerIndexes}
            renderItem={this._renderRow}
            itemHeight={ROW_HEIGHT}
            columnCount={1}
            focusable={true}
            specialItems={this._specialItems}
            containerWidth={width}
            forceRender={forceRenderKey}
            disableOverscan={disableOverscan}
            onCopy={this._onCopy}
            onKeyDown={this._onKeyDown}
          />
        )}
      </div>
    );
  }
}

/**
 * Wrap the component in the WithSize higher order component, as well as the redux
 * connected component.
 */
const ConnectedComponent = explicitConnect<OwnProps, StateProps, DispatchProps>(
  {
    mapStateToProps: state => {
      return {
        markerIndexes: selectedThreadSelectors.getSearchFilteredNetworkMarkerIndexes(
          state
        ),
        getMarker: selectedThreadSelectors.getMarkerGetter(state),
        timeRange: getPreviewSelectionRange(state),
        disableOverscan: getPreviewSelection(state).isModifying,
        threadIndex: getSelectedThreadIndex(state),
      };
    },
    component: NetworkChart,
  }
);

export default withSize<OwnProps>(ConnectedComponent);

/**
 * Our definition of markers does not currently have the ability to refine
 * the union of all payloads to one specific payload through the type definition.
 * This function does a runtime check to do so.
 */
function _getNetworkPayloadOrNull(marker: Marker): null | NetworkPayload {
  if (!marker.data || marker.data.type !== 'Network') {
    return null;
  }
  return marker.data;
}
