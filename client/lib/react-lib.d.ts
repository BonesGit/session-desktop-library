/**
 * Library-mode React type augmentation.
 *
 * The real ts/react.d.ts imports from ts/updater/ and ts/themes/ which are
 * excluded from the library build. This stripped-down version provides just
 * the `SessionDataTestId` type used by React components that the model layer
 * transitively pulls into the compilation.
 */

import 'react';

declare module 'react' {
  // Simplified catch-all for data-testid values — the library doesn't render UI
  type SessionDataTestId = string;

  interface HTMLAttributes {
    'data-testid'?: SessionDataTestId;
  }
}
