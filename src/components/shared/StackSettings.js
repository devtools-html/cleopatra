/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import React, { PureComponent } from 'react';
import { connect } from 'react-redux';
import {
  changeImplementationFilter,
  changeInvertCallstack,
} from '../../actions/profile-view';
import {
  getImplementationFilter,
  getInvertCallstack,
} from '../../reducers/url-state';
import StackSearchField from '../shared/StackSearchField';
import { toValidImplementationFilter } from '../../profile-logic/profile-data';

import './StackSettings.css';

import type { ImplementationFilter } from '../../types/actions';

type Props = {|
  +implementationFilter: ImplementationFilter,
  +invertCallstack: boolean,
  +hideInvertCallstack?: boolean,
  +changeImplementationFilter: typeof changeImplementationFilter,
  +changeInvertCallstack: typeof changeInvertCallstack,
|};

class StackSettings extends PureComponent<Props> {
  _onImplementationFilterChange = (e: SyntheticEvent<HTMLSelectElement>) => {
    this.props.changeImplementationFilter(
      // This function is here to satisfy Flow that we are getting a valid
      // implementation filter.
      toValidImplementationFilter(e.currentTarget.value)
    );
  };

  _onInvertCallstackClick = (e: SyntheticEvent<HTMLInputElement>) => {
    this.props.changeInvertCallstack(e.currentTarget.checked);
  };

  render() {
    const {
      implementationFilter,
      invertCallstack,
      hideInvertCallstack,
    } = this.props;

    return (
      <div className="stackSettings">
        <ul className="stackSettingsList">
          <li className="stackSettingsListItem">
            <label className="stackSettingsLabel">
              Filter:
              <select
                className="stackSettingsSelect"
                onChange={this._onImplementationFilterChange}
                value={implementationFilter}
              >
                <option value="combined">Combined stacks</option>
                <option value="js">JS only</option>
                <option value="cpp">C++ only</option>
              </select>
            </label>
          </li>
          {hideInvertCallstack ? null : (
            <li className="stackSettingsListItem">
              <label className="stackSettingsLabel">
                <input
                  type="checkbox"
                  className="stackSettingsCheckbox"
                  onChange={this._onInvertCallstackClick}
                  checked={invertCallstack}
                />
                {' Invert call stack'}
              </label>
            </li>
          )}
        </ul>
        <StackSearchField className="stackSettingsSearchField" />
      </div>
    );
  }
}

export default connect(
  state => ({
    invertCallstack: getInvertCallstack(state),
    implementationFilter: getImplementationFilter(state),
  }),
  {
    changeImplementationFilter,
    changeInvertCallstack,
  }
)(StackSettings);
