/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import { type Milliseconds } from '../types/units';

// The following are the margin sizes for the left and right of the timeline. Independent
// components need to share these values.
export const TIMELINE_MARGIN_RIGHT = 15;
export const TIMELINE_MARGIN_LEFT = 150;

// How long do we wait until we show a tooltip?
export const TOOLTIP_TIMEOUT: Milliseconds = 250;
