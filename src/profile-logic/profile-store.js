/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// @flow
import { oneLine } from 'common-tags';
import { PROFILER_SERVER_ORIGIN } from 'firefox-profiler/app-logic/constants';

// This is the server we use to publish new profiles.
const PUBLISHING_ENDPOINT = `${PROFILER_SERVER_ORIGIN}/compressed-store`;
// Uncomment the following endpoint instead to use your local server.
//const PUBLISHING_ENDPOINT = 'http://localhost:5252/compressed-store';

const ACCEPT_HEADER_VALUE = 'application/vnd.firefox-profiler+json;version=1.0';

export function uploadBinaryProfileData(): * {
  const xhr = new XMLHttpRequest();
  let isAborted = false;

  return {
    abortFunction: (): void => {
      isAborted = true;
      xhr.abort();
    },
    startUpload: (
      data: $TypedArray,
      progressChangeCallback?: number => mixed
    ): Promise<string> =>
      new Promise((resolve, reject) => {
        if (isAborted) {
          reject(new Error('The request was already aborted.'));
          return;
        }

        xhr.onload = () => {
          switch (xhr.status) {
            case 413:
              reject(
                new Error(
                  oneLine`
                    The profile size is too large.
                    You can try enabling some of the privacy features to trim its size down.
                  `
                )
              );
              break;
            default:
              if (xhr.status >= 200 && xhr.status <= 299) {
                // Success!
                resolve(xhr.responseText);
              } else {
                reject(
                  new Error(
                    `xhr onload with status != 200, xhr.statusText: ${xhr.statusText}`
                  )
                );
              }
          }
        };

        xhr.onerror = () => {
          console.error(
            'There was an XHR network error in uploadBinaryProfileData()',
            xhr
          );

          let errorMessage =
            'Unable to make a connection to publish the profile.';
          if (xhr.statusText) {
            errorMessage += ` The error response was: ${xhr.statusText}`;
          }
          reject(new Error(errorMessage));
        };

        xhr.upload.onprogress = e => {
          if (progressChangeCallback && e.lengthComputable) {
            progressChangeCallback(e.loaded / e.total);
          }
        };

        xhr.open('POST', PUBLISHING_ENDPOINT);
        xhr.setRequestHeader('Accept', ACCEPT_HEADER_VALUE);
        xhr.send(data);
      }),
  };
}
