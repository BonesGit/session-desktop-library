/**
 * Global Window Shim for the Session library.
 *
 * The Session backend uses ~15 window.* globals:
 *   - window.log              (~422 usages in session/, receiver/, models/)
 *   - window.Whisper.events   (internal event bus for registration/sync signals)
 *   - window.isOnline         (guards swarm polling and onion routing)
 *   - window.inboxStore       (Redux dispatch/getState — replaced with stub store)
 *   - window.sessionBooleanFeatureFlags  (feature flags used by snode pool, onion routing)
 *   - window.sessionDataFeatureFlags     (data feature flags)
 *   - window.getSeedNodeList  (bootstrap seed node URLs)
 *   - window.setSettingValue  (Storage.put shortcut)
 *   - window.getSettingValue  (Storage.get shortcut)
 *   - window.URL              (URL parsing — already available in Node.js as globalThis.URL)
 *   - window.platform         (platform string — process.platform)
 *
 * This function MUST be called before any backend module is imported or executed.
 * The optional chaining (window?.log?.info) used throughout the backend is safe
 * even before this shim is installed.
 */

import pino from 'pino';
import { SessionEventEmitter } from '../../ts/shared/event_emitter';
import { createStubStore } from './stubStore';
import { internalEmitter } from './internalEmitter';
import type { SessionClientConfig } from '../types';
import type { SessionBooleanFeatureFlags, SessionDataFeatureFlags } from '../../ts/state/ducks/types/releasedFeaturesReduxTypes';

// Default feature flags — all features off/default, no debug logging
const defaultBooleanFeatureFlags: SessionBooleanFeatureFlags = {
  replaceLocalizedStringsWithKeys: false,
  disableOnionRequests: false,
  disableImageProcessor: false,
  disableLocalAttachmentEncryption: false,
  useDeterministicEncryption: false,
  useTestNet: false,
  useTestProBackend: false,
  useClosedGroupV2QAButtons: false,
  alwaysShowRemainingChars: false,
  showPopoverAnchors: false,
  debugInputCommands: false,
  proAvailable: false,
  proGroupsAvailable: false,
  mockCurrentUserHasProPlatformRefundExpired: false,
  mockCurrentUserHasProCancelled: false,
  mockCurrentUserHasProInGracePeriod: false,
  mockProRecoverButtonAlwaysSucceed: false,
  mockProRecoverButtonAlwaysFail: false,
  mockProBackendLoading: false,
  mockProBackendError: false,
  fsTTL30s: false,
  debugForceSeedNodeFailure: false,
  debugLogging: false,
  debugLibsessionDumps: false,
  debugBuiltSnodeRequests: false,
  debugSwarmPolling: false,
  debugServerRequests: false,
  debugNonSnodeRequests: false,
  debugOnionPaths: false,
  debugSnodePool: false,
  debugOnionRequests: false,
  debugInsecureNodeFetch: false,
  debugOnlineState: false,
  debugKeyboardShortcuts: false,
  debugFocusScope: false,
};

const defaultDataFeatureFlags: SessionDataFeatureFlags = {
  useLocalDevNet: null,
  mockMessageProFeatures: null,
  mockProCurrentStatus: null,
  mockProPaymentProvider: null,
  mockProAccessVariant: null,
  mockProAccessExpiry: null,
  mockProLongerMessagesSent: null,
  mockProPinnedConversations: null,
  mockProBadgesSent: null,
  mockProGroupsUpgraded: null,
  mockNetworkPageNodeCount: null,
  fakeAvatarPickerColor: null,
};

// Production seed nodes — same as the app uses by default
export const defaultSeedNodes = [
  'https://seed1.getsession.org',
  'https://seed2.getsession.org',
  'https://seed3.getsession.org',
];

let shimInstalled = false;

export function installWindowShim(config: SessionClientConfig): void {
  if (shimInstalled) {
    return;
  }
  shimInstalled = true;

  const logger = config.logger ?? pino({ level: config.logLevel ?? 'info', name: 'session-lib' });

  const whisperEvents = new SessionEventEmitter();
  const stubStore = createStubStore(internalEmitter);

  // We need a lazy import of Storage to avoid circular deps at shim install time
  // Storage.put/get are bound lazily below
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storagePut = async (key: string, value: any) => {
    const { Storage } = await import('../../ts/util/storage');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Storage.put(key, value as any);
  };
  const storageGet = (key: string): unknown => {
    try {
      // Synchronous — Storage.get is sync once initialized
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Storage } = require('../../ts/util/storage') as typeof import('../../ts/util/storage');
      return Storage.get(key);
    } catch {
      return undefined;
    }
  };

  // Minimal in-memory localStorage stub (used by accountManager for delete-account flow)
  const localStorageData: Record<string, string> = {};
  const localStorageStub = {
    setItem: (key: string, value: string) => { localStorageData[key] = value; },
    getItem: (key: string): string | null => localStorageData[key] ?? null,
    removeItem: (key: string) => { delete localStorageData[key]; },
    clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); },
  };

  // storageMigrations.ts accesses `localStorage.getItem()` as a bare global (not window.localStorage).
  // Node.js 25 has a built-in localStorage but without --localstorage-file it lacks getItem.
  // Override global.localStorage with the same stub so both access paths work.
  (global as Record<string, unknown>).localStorage = localStorageStub;

  (global as Record<string, unknown>).window = {
    log: logger,
    Whisper: { events: whisperEvents },
    isOnline: true,
    inboxStore: stubStore,
    sessionBooleanFeatureFlags: {
      ...defaultBooleanFeatureFlags,
      ...(config.featureFlags ?? {}),
    },
    sessionDataFeatureFlags: { ...defaultDataFeatureFlags },
    getSeedNodeList: () => config.seedNodes ?? defaultSeedNodes,
    setSettingValue: storagePut,
    getSettingValue: storageGet,
    URL: globalThis.URL,
    platform: process.platform,
    localStorage: localStorageStub,
    // In library mode, restart is a no-op (no Electron app to restart)
    restart: () => { logger.warn('[session-lib] window.restart() called — ignored in library mode'); },
    // setOpengroupPruning: persists the pruning setting to Storage
    setOpengroupPruning: async (value: boolean) =>
      storagePut('settingsOpengroupPruning', value as unknown as never),
    // focusListener.js calls window.addEventListener at module load time — no-op in Node.js
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

export function setOnlineStatus(online: boolean): void {
  const w = (global as Record<string, unknown>).window as Record<string, unknown> | undefined;
  if (w) {
    w.isOnline = online;
  }
}
