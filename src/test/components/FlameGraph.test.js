/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import FlameGraph from '../../components/flame-graph';
import { render, fireEvent } from 'react-testing-library';
import { Provider } from 'react-redux';
import mockCanvasContext from '../fixtures/mocks/canvas-context';
import { storeWithProfile } from '../fixtures/stores';
import {
  getBoundingBox,
  addRootOverlayElement,
  removeRootOverlayElement,
  getMouseEvent,
} from '../fixtures/utils';
import { getProfileFromTextSamples } from '../fixtures/profiles/processed-profile';
import {
  changeInvertCallstack,
  changeSelectedCallNode,
} from '../../actions/profile-view';
import { selectedThreadSelectors } from '../../selectors/per-thread';
import mockRaf from '../fixtures/mocks/request-animation-frame';
import { getInvertCallstack } from '../../selectors/url-state';
import { ensureExists } from '../../utils/flow';

const GRAPH_WIDTH = 200;
const GRAPH_HEIGHT = 300;

describe('FlameGraph', function() {
  afterEach(removeRootOverlayElement);
  beforeEach(addRootOverlayElement);

  it('matches the snapshot', () => {
    const { ctx, container } = setupFlameGraph();
    const drawCalls = ctx.__flushDrawLog();

    expect(container.firstChild).toMatchSnapshot();
    expect(drawCalls).toMatchSnapshot();
  });

  it('renders a message instead of the graph when call stack is inverted', () => {
    const { getByText, dispatch } = setupFlameGraph();
    dispatch(changeInvertCallstack(true));
    expect(getByText(/The Flame Graph is not available/)).toBeDefined();
  });

  it('switches back to uninverted mode when clicking the button', () => {
    const { getByText, dispatch, getState } = setupFlameGraph();
    dispatch(changeInvertCallstack(true));
    expect(getInvertCallstack(getState())).toBe(true);
    fireEvent.click(getByText(/Switch to the normal call stack/));
    expect(getInvertCallstack(getState())).toBe(false);
  });

  it('shows a tooltip when hovering', () => {
    const { getTooltip, moveMouse } = setupFlameGraph();
    expect(getTooltip()).toBe(null);
    moveMouse(GRAPH_WIDTH * 0.5, GRAPH_HEIGHT - 3);
    expect(getTooltip()).toBeTruthy();
  });

  it('has a tooltip that matches the screenshot', () => {
    const { getTooltip, moveMouse } = setupFlameGraph();
    moveMouse(GRAPH_WIDTH * 0.5, GRAPH_HEIGHT - 3);
    expect(getTooltip()).toMatchSnapshot();
  });

  it('can be navigated with the keyboard', () => {
    const { getState, dispatch, getContentDiv, funcNames } = setupFlameGraph();
    const div = getContentDiv();

    function selectedNode() {
      const callNodeIndex = selectedThreadSelectors.getSelectedCallNodeIndex(
        getState()
      );
      return callNodeIndex && funcNames[callNodeIndex];
    }

    // Start out with callnode B selected
    dispatch(changeSelectedCallNode(0, [0, 1] /* B */));
    expect(selectedNode()).toBe('B');

    // Move one callnode up
    fireEvent.keyDown(div, { key: 'ArrowUp' });
    expect(selectedNode()).toBe('C');

    // Move one callnode right
    fireEvent.keyDown(div, { key: 'ArrowRight' });
    expect(selectedNode()).toBe('H');

    // Go back to left again
    fireEvent.keyDown(div, { key: 'ArrowLeft' });
    expect(selectedNode()).toBe('C');

    // And down, back to our starting callnode again
    fireEvent.keyDown(div, { key: 'ArrowDown' });
    expect(selectedNode()).toBe('B');
  });
});

function setupFlameGraph() {
  const flushRafCalls = mockRaf();
  const ctx = mockCanvasContext();

  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => getBoundingBox(GRAPH_WIDTH, GRAPH_HEIGHT));

  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx);

  const {
    profile,
    funcNamesPerThread: [funcNames],
  } = getProfileFromTextSamples(`
    A[cat:DOM]       A[cat:DOM]       A[cat:DOM]
    B[cat:DOM]       B[cat:DOM]       B[cat:DOM]
    C[cat:Graphics]  C[cat:Graphics]  H[cat:Network]
    D[cat:Graphics]  F[cat:Graphics]  I[cat:Network]
    E[cat:Graphics]  G[cat:Graphics]
  `);

  const store = storeWithProfile(profile);

  const { container, getByText } = render(
    <Provider store={store}>
      <FlameGraph />
    </Provider>
  );

  flushRafCalls();

  function moveMouse(x, y) {
    fireEvent(
      ensureExists(
        container.querySelector('canvas'),
        'The container should contain a canvas element.'
      ),
      getMouseEvent('mousemove', {
        pageX: x,
        pageY: y,
        clientX: x,
        clientY: y,
        offsetX: x,
        offsetY: y,
      })
    );
  }

  /**
   * The tooltip is in a portal, and created in the root overlay elements.
   */
  function getTooltip() {
    return document.querySelector('#root-overlay .tooltip');
  }

  /**
   * The content div is the one receiving keyboard events for navigation.
   */
  function getContentDiv() {
    return ensureExists(
      container.querySelector('.flameGraphContent'),
      `Couldn't find the content div with selector .flameGraphContent`
    );
  }

  return {
    container,
    funcNames,
    getByText,
    ctx,
    moveMouse,
    getTooltip,
    getContentDiv,
    ...store,
  };
}
