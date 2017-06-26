/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {createStore, applyMiddleware} from 'redux';
import threadDispatcher from '../common/thread-middleware';
import handleMessages from '../common/message-handler';
import messages from './messages';
import reducers from './reducers';
import { createLogger } from 'redux-logger';
import thunk from 'redux-thunk';

const store = createStore(
  // Reducers:
  reducers,
  // Initial State:
  {},
  // Enhancers:
  applyMiddleware(...[
    thunk,
    threadDispatcher(self, 'toContent'),
    process.env.NODE_ENV === 'development'
      ? createLogger({ titleFormatter: action => `worker action ${action.type}` })
      : null,
  ].filter(fn => fn)));

handleMessages(self, store, messages);
