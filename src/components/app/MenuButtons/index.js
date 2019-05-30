/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import classNames from 'classnames';
import explicitConnect from '../../../utils/connect';
import { getProfile, getProfileRootRange } from '../../../selectors/profile';
import { getDataSource } from '../../../selectors/url-state';
import { getIsNewlyPublished } from '../../../selectors/app';
import { MenuButtonsMetaInfo } from './MetaInfo';
import { MenuButtonsPublish } from './Publish';
import { MenuButtonsPermalink } from './Permalink';
import ArrowPanel from '../../shared/ArrowPanel';
import ButtonWithPanel from '../../shared/ButtonWithPanel';
import { revertToOriginalProfile, abortUpload } from '../../../actions/publish';
import { dismissNewlyPublished } from '../../../actions/app';
import { getUploadPhase, getOriginalProfile } from '../../../selectors/publish';

import type { StartEndRange } from '../../../types/units';
import type { Profile } from '../../../types/profile';
import type { DataSource } from '../../../types/actions';
import type { ConnectedProps } from '../../../utils/connect';
import type { UploadPhase } from '../../../types/state';

require('./index.css');

type OwnProps = {|
  // This is for injecting a URL shortener for tests. Normally we would use a Jest mock
  // that would mock out a local module, but I was having trouble getting it working
  // correctly (perhaps due to ES6 modules), so I just went with dependency injection
  // instead.
  injectedUrlShortener?: string => Promise<string>,
|};

type StateProps = {|
  +profile: Profile,
  +rootRange: StartEndRange,
  +dataSource: DataSource,
  +isNewlyPublished: boolean,
  +uploadPhase: UploadPhase,
  +originalProfile: null | Profile,
|};

type DispatchProps = {|
  +dismissNewlyPublished: typeof dismissNewlyPublished,
  +revertToOriginalProfile: typeof revertToOriginalProfile,
  +abortUpload: typeof abortUpload,
|};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps>;

class MenuButtons extends React.PureComponent<Props> {
  componentDidMount() {
    // Clear out the newly published notice from the URL.
    this.props.dismissNewlyPublished();
  }

  _renderPublishPanel() {
    const { uploadPhase, dataSource, abortUpload } = this.props;

    const isUploading =
      uploadPhase === 'uploading' || uploadPhase === 'compressing';

    if (isUploading) {
      return (
        <button
          type="button"
          className="buttonWithPanelButton menuButtonsAbortUploadButton"
          onClick={abortUpload}
        >
          Cancel Upload
        </button>
      );
    }

    const isRepublish =
      dataSource === 'public' ||
      dataSource === 'from-url' ||
      dataSource === 'compare';
    const isError = uploadPhase === 'error';

    let label = 'Publish…';
    if (isRepublish) {
      label = 'Re-publish…';
    }
    if (isError) {
      label = 'Error publishing…';
    }

    return (
      <ButtonWithPanel
        className={classNames({
          menuButtonsShareButton: true,
          menuButtonsShareButtonOriginal: !isRepublish && !isError,
          menuButtonsShareButtonError: isError,
        })}
        label={label}
        panel={
          <ArrowPanel className="menuButtonsPublishPanel">
            <MenuButtonsPublish isRepublish={isRepublish} />
          </ArrowPanel>
        }
      />
    );
  }

  _renderPermalink() {
    const { dataSource, isNewlyPublished, injectedUrlShortener } = this.props;

    const showPermalink =
      dataSource === 'public' ||
      dataSource === 'from-url' ||
      dataSource === 'compare';

    return showPermalink ? (
      <MenuButtonsPermalink
        isNewlyPublished={isNewlyPublished}
        injectedUrlShortener={injectedUrlShortener}
      />
    ) : null;
  }

  _renderRevertProfile() {
    const { originalProfile, revertToOriginalProfile } = this.props;
    if (!originalProfile) {
      return null;
    }
    return (
      <button
        type="button"
        className="buttonWithPanelButton menuButtonsRevertButton"
        onClick={revertToOriginalProfile}
      >
        Revert to Original Profile
      </button>
    );
  }

  render() {
    const { profile } = this.props;
    return (
      <>
        {/* Place the info button outside of the menu buttons to allow it to shrink. */}
        <MenuButtonsMetaInfo profile={profile} />
        <div className="menuButtons">
          {this._renderRevertProfile()}
          {this._renderPublishPanel()}
          {this._renderPermalink()}
          <a
            href="/docs/"
            target="_blank"
            className="menuButtonsLink"
            title="Open the documentation in a new window"
          >
            Docs
            <i className="open-in-new" />
          </a>
        </div>
      </>
    );
  }
}

export default explicitConnect<OwnProps, StateProps, DispatchProps>({
  mapStateToProps: state => ({
    profile: getProfile(state),
    rootRange: getProfileRootRange(state),
    dataSource: getDataSource(state),
    isNewlyPublished: getIsNewlyPublished(state),
    uploadPhase: getUploadPhase(state),
    originalProfile: getOriginalProfile(state),
  }),
  mapDispatchToProps: {
    dismissNewlyPublished,
    revertToOriginalProfile,
    abortUpload,
  },
  component: MenuButtons,
});
