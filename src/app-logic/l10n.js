/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import { FluentBundle, FluentResource } from '@fluent/bundle';
import engFtlFile from '../../locales/en-US/app.ftl';

export const AVAILABLE_LOCALES: Array<string> = ['en-US'];
export const DEFAULT_LOCALE = 'en-US';

// FIXME: This needs rework, to make it generic. As we'll fetch ftl's depending on users locale.
export async function fetchMessages(locale: string): Promise<[string, string]> {
  const response = await fetch(engFtlFile);
  const messages = await response.text();
  return [locale, messages];
}

// A generator function responsible for building the sequence
// of FluentBundle instances in the order of user's language
// preferences.
export function* lazilyParsedBundles(
  fetchedMessages: Array<[string, string]>
): Generator<FluentBundle, void, void> {
  for (const [locale, messages] of fetchedMessages) {
    const resource = new FluentResource(messages);
    const bundle = new FluentBundle(locale);
    bundle.addResource(resource);
    yield bundle;
  }
}
