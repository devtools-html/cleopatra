/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import React, { PureComponent } from 'react';
import { ContextMenu, MenuItem } from 'react-contextmenu';
import explicitConnect from '../../utils/connect';
import { updatePreviewSelection } from '../../actions/profile-view';
import {
  getPreviewSelection,
  getCommittedRange,
} from '../../selectors/profile';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import copy from 'copy-to-clipboard';

import type { Marker, IndexIntoMarkers } from '../../types/profile-derived';
import type { StartEndRange } from '../../types/units';
import type {
  PreviewSelection,
  ImplementationFilter,
} from '../../types/actions';
import type { ConnectedProps } from '../../utils/connect';
import { getImplementationFilter } from '../../selectors/url-state';
import type { Thread, IndexIntoStackTable } from '../../types/profile';
import { filterCallNodePathByImplementation } from '../../profile-logic/transforms';
import {
  convertStackToCallNodePath,
  getFuncNamesAndOriginsForPath,
} from '../../profile-logic/profile-data';
import { getMarkerFullDescription } from '../../profile-logic/marker-data';

type StateProps = {|
  +markers: Marker[],
  +previewSelection: PreviewSelection,
  +committedRange: StartEndRange,
  +selectedMarker: IndexIntoMarkers | null,
  +thread: Thread,
  +implementationFilter: ImplementationFilter,
|};

type DispatchProps = {|
  +updatePreviewSelection: typeof updatePreviewSelection,
|};

type Props = ConnectedProps<{||}, StateProps, DispatchProps>;

class MarkersContextMenu extends PureComponent<Props> {
  setStartRange = () => {
    const {
      selectedMarker,
      markers,
      updatePreviewSelection,
      previewSelection,
      committedRange,
    } = this.props;

    if (selectedMarker === null) {
      return;
    }

    const selectionEnd = previewSelection.hasSelection
      ? previewSelection.selectionEnd
      : committedRange.end;

    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart: markers[selectedMarker].start,
      selectionEnd,
    });
  };

  setEndRange = () => {
    const {
      selectedMarker,
      markers,
      updatePreviewSelection,
      committedRange,
      previewSelection,
    } = this.props;

    if (selectedMarker === null) {
      return;
    }

    const selectionStart = previewSelection.hasSelection
      ? previewSelection.selectionStart
      : committedRange.start;

    const marker = markers[selectedMarker];
    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart,
      // For markers without a duration, add an arbitrarily small bit of time at
      // the end to make sure the selected marker doesn't disappear from view.
      selectionEnd: marker.start + (marker.dur || 0.0001),
    });
  };

  setRangeByDuration = () => {
    const { selectedMarker, markers, updatePreviewSelection } = this.props;

    if (selectedMarker === null) {
      return;
    }

    const marker = markers[selectedMarker];
    if (this._isZeroDurationMarker(marker)) {
      return;
    }

    updatePreviewSelection({
      hasSelection: true,
      isModifying: false,
      selectionStart: marker.start,
      selectionEnd: marker.start + marker.dur,
    });
  };

  _isZeroDurationMarker(marker: ?Marker): boolean {
    return !marker || !marker.dur;
  }

  _convertStackToString(stack: IndexIntoStackTable): string {
    const { thread, implementationFilter } = this.props;

    const callNodePath = filterCallNodePathByImplementation(
      thread,
      implementationFilter,
      convertStackToCallNodePath(thread, stack)
    );

    const funcNamesAndOrigins = getFuncNamesAndOriginsForPath(
      callNodePath,
      thread
    );
    return funcNamesAndOrigins
      .map(({ funcName, origin }) => `${funcName} [${origin}]`)
      .join('\n');
  }

  copyMarkerJSON = () => {
    const { selectedMarker, markers } = this.props;

    if (selectedMarker === null) {
      return;
    }

    copy(JSON.stringify(markers[selectedMarker], null, 2));
  };

  copyMarkerDescription = () => {
    const { selectedMarker, markers } = this.props;

    if (selectedMarker === null) {
      return;
    }
    const marker = markers[selectedMarker];
    copy(getMarkerFullDescription(marker));
  };

  copyMarkerCause = () => {
    const { markers, selectedMarker } = this.props;

    if (selectedMarker === null) {
      return;
    }

    const marker = markers[selectedMarker];
    if (marker && marker.data && marker.data.cause) {
      const stack = this._convertStackToString(marker.data.cause.stack);
      copy(stack);
    }
  };

  render() {
    const { markers, selectedMarker } = this.props;

    if (selectedMarker === null) {
      return null;
    }

    const marker = markers[selectedMarker];

    return (
      <ContextMenu id="MarkersContextMenu">
        <MenuItem onClick={this.setStartRange}>
          Set selection start time here
        </MenuItem>
        <MenuItem onClick={this.setEndRange}>
          Set selection end time here
        </MenuItem>
        <MenuItem
          onClick={this.setRangeByDuration}
          disabled={this._isZeroDurationMarker(marker)}
        >
          Set selection from duration
        </MenuItem>
        <MenuItem onClick={this.copyMarkerJSON}>Copy marker JSON</MenuItem>
        <MenuItem onClick={this.copyMarkerDescription}>
          Copy marker description
        </MenuItem>
        {marker && marker.data && marker.data.cause ? (
          <MenuItem onClick={this.copyMarkerCause}>Copy marker cause</MenuItem>
        ) : null}
      </ContextMenu>
    );
  }
}

export default explicitConnect<{||}, StateProps, DispatchProps>({
  mapStateToProps: state => ({
    markers: selectedThreadSelectors.getPreviewFilteredMarkers(state),
    previewSelection: getPreviewSelection(state),
    committedRange: getCommittedRange(state),
    thread: selectedThreadSelectors.getThread(state),
    implementationFilter: getImplementationFilter(state),
    selectedMarker: selectedThreadSelectors.getSelectedMarkerIndex(state),
  }),
  mapDispatchToProps: { updatePreviewSelection },
  component: MarkersContextMenu,
});
