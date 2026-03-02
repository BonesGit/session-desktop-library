/**
 * Minimal Redux-like stub store for the library build.
 *
 * The Session backend calls:
 *   window.inboxStore?.dispatch(action)      — to update UI state
 *   window.inboxStore?.getState()            — to read onion paths / quoted messages
 *
 * In library mode we:
 *   - Run the action through libraryReducer to maintain the small state slice backend reads
 *   - Re-emit dispatched actions on the internalEmitter so SessionClient can surface them
 */

import type { EventEmitter } from 'events';
import { getInitialLibraryState, libraryReducer, type LibraryState } from './libraryReducer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;

export interface StubStore {
  dispatch: (action: AnyValue) => AnyValue;
  getState: () => LibraryState;
}

export function createStubStore(emitter: EventEmitter): StubStore {
  let state: LibraryState = getInitialLibraryState();

  const store: StubStore = {
    dispatch(action: AnyValue): AnyValue {
      // Redux Thunk middleware: if the action is a function, call it as a thunk
      if (typeof action === 'function') {
        return action(store.dispatch, store.getState, undefined);
      }
      state = libraryReducer(state, action);
      // Re-emit for SessionClient to handle
      emitter.emit('redux:dispatch', action);
    },
    getState() {
      return state;
    },
  };

  return store;
}
