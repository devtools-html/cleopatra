/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import * as React from 'react';
import { render, fireEvent } from 'react-testing-library';
import ButtonWithPanel from '../../components/shared/ButtonWithPanel';
import ArrowPanel from '../../components/shared/ArrowPanel';
import { ensureExists } from '../../utils/flow';

describe('shared/ButtonWithPanel', () => {
  // renders the button in its default state
  function setup() {
    return render(
      <ButtonWithPanel
        className="button"
        label="My Button"
        panel={
          <ArrowPanel className="panel">
            <div>Panel content</div>
          </ArrowPanel>
        }
      />
    );
  }

  it('renders the ButtonWithPanel with a closed panel', () => {
    const { container } = setup();
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders a button with a panel', () => {
    const { container } = render(
      <ButtonWithPanel
        className="button"
        label="My Button"
        open={true}
        panel={
          <ArrowPanel className="panel">
            <div>Panel content</div>
          </ArrowPanel>
        }
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('renders a disabled button', () => {
    const { container } = render(
      <ButtonWithPanel
        className="button"
        label="My Button"
        disabled={true}
        panel={
          <ArrowPanel className="panel">
            <div>Panel content</div>
          </ArrowPanel>
        }
      />
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('opens the panel when the button is clicked and closes the panel when the escape key is pressed', () => {
    const { getByValue, container } = setup();

    fireEvent.click(getByValue('My Button'));
    expect(container.firstChild).toMatchSnapshot();

    //it closes the panel when Esc key is pressed
    fireEvent.keyDown(container, {
      key: 'Escape',
      keyCode: 27,
      which: 27,
    });
    expect(container.firstChild).toMatchSnapshot();
  });

  it('opens the panel when the button is clicked and closes the panel by clicking outside the panel', () => {
    const { getByValue, container } = setup();

    fireEvent.click(getByValue('My Button'));
    expect(container.firstChild).toMatchSnapshot();

    //it closes the panel when clicking outside the panel
    const newDiv = ensureExists(document.body).appendChild(
      document.createElement('div')
    );
    fireEvent.mouseDown(newDiv);

    expect(container.firstChild).toMatchSnapshot();
  });
});
