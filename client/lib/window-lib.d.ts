/**
 * Library-mode Window type augmentation.
 *
 * This is a stripped-down version of ts/window.d.ts that avoids importing
 * browser-only packages (styled-components, Electron themes, etc.).
 *
 * Provides the same `window.*` global types that the Session backend code
 * relies on, so type-checking passes in the Node.js library build.
 */

import type { EventEmitter } from '../../ts/shared/event_emitter';
import type {
  SessionDataFeatureFlags,
  SessionBooleanFeatureFlags,
} from '../../ts/state/ducks/types/releasedFeaturesReduxTypes';

declare global {
  interface Window {
    Events: any;
    Whisper: { events: EventEmitter };
    clearLocalData: () => Promise<void>;
    clipboard: any;
    getSettingValue: (id: string, comparisonValue?: any) => any;
    setSettingValue: (id: string, value: any) => Promise<void>;
    log: any;
    sessionBooleanFeatureFlags: SessionBooleanFeatureFlags;
    sessionDataFeatureFlags: SessionDataFeatureFlags;
    onLogin: (pw: string) => Promise<void>;
    onTryPassword: (pw: string) => Promise<void>;
    restart: () => void;
    getSeedNodeList: () => Array<string> | undefined;
    setPassword: (
      newPassword: string | null,
      oldPassword: string | null
    ) => Promise<string | undefined>;
    isOnline: boolean;
    toggleMediaPermissions: () => Promise<void>;
    toggleCallMediaPermissionsTo: (enabled: boolean) => Promise<void>;
    getCallMediaPermissions: () => boolean;
    toggleMenuBar: () => void;
    toggleSpellCheck: () => void;
    primaryColor: string;
    theme: string;
    versionInfo: { environment: string; version: string; commitHash: string; appInstance: string };
    readyForUpdates: () => void;
    drawAttention: () => void;
    platform: string;
    openFromNotification: (conversationKey?: string) => void;
    getEnvironment: () => string;
    getNodeVersion: () => string;
    showWindow: () => void;
    setCallMediaPermissions: (val: boolean) => void;
    setMediaPermissions: (val: boolean) => void;
    askForMediaAccess: () => void;
    getMediaPermissions: () => boolean;
    nodeSetImmediate: any;
    getTitle: () => string;
    getAppInstance: () => string;
    getCommitHash: () => string | undefined;
    getVersion: () => string;
    getOSRelease: () => string;
    saveLog: () => void;
    setAutoHideMenuBar: (val: boolean) => void;
    setMenuBarVisibility: (val: boolean) => void;
    contextMenuShown: boolean;
    inboxStore?: { dispatch: (action: any) => void; getState: () => any };
    getState: () => unknown;
    openConversationWithMessages: (args: {
      conversationKey: string;
      messageId: string | null;
    }) => Promise<void>;
    setStartInTray: (val: boolean) => Promise<void>;
    getStartInTray: () => Promise<boolean>;
    getOpengroupPruning: () => Promise<boolean>;
    setOpengroupPruning: (val: boolean) => Promise<void>;
    closeAbout: () => void;
    getAutoUpdateEnabled: () => boolean;
    setAutoUpdateEnabled: (enabled: boolean) => void;
    setZoomFactor: (newZoom: number) => void;
    updateZoomFactor: () => void;
    getUserKeys: () => Promise<{ id: string; vbid: string }>;
    localStorage: {
      setItem: (key: string, value: string) => void;
      getItem: (key: string) => string | null;
      removeItem: (key: string) => void;
      clear: () => void;
    };
  }
}
