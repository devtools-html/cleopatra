/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import React from 'react';
import CallTree from './CallTree';
import StackSettings from '../shared/StackSettings';
import TransformNavigator from '../shared/TransformNavigator';
import SelectedThreadActivityGraph from '../shared/SelectedThreadActivityGraph';

const ProfileCallTreeView = () => (
  <div className="treeAndSidebarWrapper">
    <StackSettings />
    <TransformNavigator />
    <SelectedThreadActivityGraph />
    <CallTree />
  </div>
);

export default ProfileCallTreeView;
