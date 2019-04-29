/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow
import { processProfile } from '../../profile-logic/process-profile';
import { sanitizePII } from '../../profile-logic/sanitize';
import { createGeckoProfile } from '../fixtures/profiles/gecko-profile';
import { ensureExists } from '../../utils/flow';
import type { RemoveProfileInformation } from '../../types/profile-derived';

describe('sanitizePII', function() {
  function getRemoveProfileInformation(
    customFields: Object
  ): RemoveProfileInformation {
    return {
      shouldRemoveThreads: new Set(),
      shouldRemoveThreadsWithScreenshots: new Set(),
      shouldRemoveUrls: false,
      shouldFilterToCommittedRange: null,
      shouldRemoveExtensions: false,
      ...customFields,
    };
  }
  it('should sanitize the threads if they are provided', function() {
    const profile = processProfile(createGeckoProfile());
    // There are 3 threads in the beginning.
    expect(profile.threads.length).toEqual(3);
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreads: new Set([0, 2]),
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    // First and last threads are removed and now there are only 1 thread.
    expect(sanitizedProfile.threads.length).toEqual(1);
  });

  it('should sanitize counters if its thread is deleted', function() {
    const profile = processProfile(createGeckoProfile());
    const { counters } = profile;
    expect(counters).not.toEqual(undefined);
    if (counters === undefined) {
      return;
    }
    expect(counters.length).toEqual(1);
    // Assuming that the mainThreadIndex of the counter is 0.
    // If that assertion fails, put back the counter where you moved from.
    expect(counters[0].mainThreadIndex).toEqual(0);

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreads: new Set([0]),
    });
    const { counters: sanitizedCounters } = sanitizePII(profile, PIIToRemove);
    // The counter was for the first thread, it should be deleted now.
    expect(sanitizedCounters).not.toEqual(undefined);
    if (sanitizedCounters !== undefined) {
      expect(sanitizedCounters.length).toEqual(0);
    }
  });

  it('should not sanitize counters if its thread is deleted', function() {
    const profile = processProfile(createGeckoProfile());
    const { counters } = profile;
    expect(counters).not.toEqual(undefined);
    if (counters === undefined) {
      return;
    }
    expect(counters.length).toEqual(1);
    // Assuming that the mainThreadIndex of the counter is 0.
    // If that assertion fails, put back the counter where you moved from.
    expect(counters[0].mainThreadIndex).toEqual(0);

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreads: new Set([1, 2]),
    });
    const { counters: sanitizedCounters } = sanitizePII(profile, PIIToRemove);
    // The counter was for the first thread, it should not be deleted now.
    expect(sanitizedCounters).not.toEqual(undefined);
    if (sanitizedCounters !== undefined) {
      expect(sanitizedCounters.length).toEqual(1);
    }
  });

  it('should sanitize the screenshots if they are provided', function() {
    const profile = processProfile(createGeckoProfile());
    // Checking if we have screenshot markers just in case.
    let screenshotMarkerFound = false;
    for (const thread of profile.threads) {
      for (const data of thread.markers.data) {
        if (data && data.type === 'CompositorScreenshot') {
          screenshotMarkerFound = true;
          break;
        }
      }
    }
    expect(screenshotMarkerFound).toEqual(true);

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveThreadsWithScreenshots: new Set([0, 1, 2]),
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    screenshotMarkerFound = false;
    for (const thread of sanitizedProfile.threads) {
      for (const data of thread.markers.data) {
        if (data && data.type === 'CompositorScreenshot') {
          screenshotMarkerFound = true;
          break;
        }
      }
    }
    expect(screenshotMarkerFound).toEqual(false);
  });

  it('should sanitize the pages information', function() {
    const profile = processProfile(createGeckoProfile());

    for (const page of ensureExists(profile.pages)) {
      expect(page.url.includes('http')).toBe(true);
    }

    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const page of ensureExists(sanitizedProfile.pages)) {
      expect(page.url.includes('http')).toBe(false);
    }
  });

  it('should sanitize all the URLs inside network markers', function() {
    const profile = processProfile(createGeckoProfile());
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const thread of sanitizedProfile.threads) {
      const stringArray = thread.stringTable.serializeToArray();
      for (let i = 0; i < thread.markers.length; i++) {
        const currentMarker = thread.markers.data[i];
        if (
          currentMarker &&
          currentMarker.type &&
          currentMarker.type === 'Network'
        ) {
          expect(currentMarker.URI).toBeFalsy();
          expect(currentMarker.RedirectURI).toBeFalsy();
          const stringIndex = thread.markers.name[i];
          expect(stringArray[stringIndex].includes('http')).toBe(false);
        }
      }
    }
  });

  it('should sanitize all the URLs inside string table', function() {
    const profile = processProfile(createGeckoProfile());
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveUrls: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    for (const thread of sanitizedProfile.threads) {
      const stringArray = thread.stringTable.serializeToArray();
      for (const string of stringArray) {
        // We are keeping the http(s) and removing the rest.
        // That's why we can't test it with `includes('http')`.
        // Tested `.com` here since all of the test urls have .com in it
        expect(string.includes('.com')).toBe(false);
      }
    }
  });

  it('should sanitize extensions', function() {
    const profile = processProfile(createGeckoProfile());
    expect(profile.meta.extensions).not.toEqual(undefined);
    // For flow
    if (profile.meta.extensions !== undefined) {
      const extensions = profile.meta.extensions;
      expect(extensions.length).toEqual(3);
      expect(extensions.id.length).toEqual(3);
      expect(extensions.name.length).toEqual(3);
      expect(extensions.baseURL.length).toEqual(3);
    }
    const PIIToRemove = getRemoveProfileInformation({
      shouldRemoveExtensions: true,
    });

    const sanitizedProfile = sanitizePII(profile, PIIToRemove);
    expect(sanitizedProfile.meta.extensions).not.toEqual(undefined);
    // For flow
    if (sanitizedProfile.meta.extensions !== undefined) {
      const extensions = sanitizedProfile.meta.extensions;
      expect(extensions.length).toEqual(0);
      expect(extensions.id.length).toEqual(0);
      expect(extensions.name.length).toEqual(0);
      expect(extensions.baseURL.length).toEqual(0);
    }
  });
});
