/**
 * Library-safe state accessors that avoid importing StateType from ts/state/reducer.ts.
 *
 * The selector files in ts/state/selectors/ import `StateType` from `ts/state/reducer.ts`,
 * which transitively pulls in all Redux ducks including UI-only ones (primaryColor.tsx,
 * call.tsx, etc.) that import from ts/themes/constants/colors.tsx and React components.
 *
 * These functions mirror the OutsideRedux functions from the selector files but use
 * `window.inboxStore?.getState() as any` to avoid the StateType import chain.
 *
 * Backend code in ts/session/, ts/models/, ts/receiver/ should import from here
 * instead of from ts/state/selectors/*.
 */

import { SettingsKey } from '../../data/settings-key';
import { PubKey } from '../types';

// --- groups selectors (replaces ts/state/selectors/groups OutsideRedux functions) ---

export function selectLibGroupNameOutsideRedux(convoId: string): string | undefined {
  const state = window.inboxStore?.getState() as any;
  if (!state || !convoId || !PubKey.is03Pubkey(convoId)) {
    return undefined;
  }
  return state.groups?.infos?.[convoId]?.name || undefined;
}

export function selectLibGroupMembersOutsideRedux(convoId: string): Array<string> {
  const state = window.inboxStore?.getState() as any;
  if (!state || !convoId || !PubKey.is03Pubkey(convoId)) {
    return [];
  }
  const members: Array<{ pubkeyHex: string }> = state.groups?.members?.[convoId] || [];
  return members.map(m => m.pubkeyHex);
}

export function selectLibGroupAdminsOutsideRedux(convoId: string): Array<string> {
  const state = window.inboxStore?.getState() as any;
  if (!state || !convoId || !PubKey.is03Pubkey(convoId)) {
    return [];
  }
  const members: Array<{ pubkeyHex: string; nominatedAdmin: boolean }> =
    state.groups?.members?.[convoId] || [];
  return members.filter(m => m.nominatedAdmin).map(m => m.pubkeyHex);
}

// --- userGroups selectors (replaces ts/state/selectors/userGroups OutsideRedux functions) ---

export function getLibGroupKickedOutsideRedux(convoId?: string): boolean | undefined {
  const state = window.inboxStore?.getState() as any;
  if (!state || !convoId || !PubKey.is03Pubkey(convoId)) {
    return undefined;
  }
  return state.userGroups?.userGroups?.[convoId]?.kicked;
}

// --- onions selectors (replaces ts/state/selectors/onions ReduxOnionSelectors) ---

export const ReduxOnionSelectors = {
  isOnlineOutsideRedux(): boolean {
    return !!(window.inboxStore?.getState() as any)?.onionPaths?.isOnline;
  },
};

// --- sogsRoomInfo dispatch helpers (replaces ReduxSogsRoomInfos from ts/state/ducks/sogsRoomInfo.tsx) ---
// Uses string action types to avoid importing the sogsRoomInfo slice (which imports modalDialog.tsx).

export const ReduxSogsRoomInfos = {
  setSubscriberCountOutsideRedux(convoId: string, subscriberCount: number) {
    window.inboxStore?.dispatch({
      type: 'sogsRoomInfos/setSubscriberCount',
      payload: { convoId, subscriberCount },
    });
  },
  setCanWriteOutsideRedux(convoId: string, canWrite: boolean) {
    window.inboxStore?.dispatch({
      type: 'sogsRoomInfos/setCanWrite',
      payload: { convoId, canWrite },
    });
  },
  setModeratorsOutsideRedux(convoId: string, moderators: Array<string>) {
    window.inboxStore?.dispatch({
      type: 'sogsRoomInfos/setModerators',
      payload: { convoId, moderators },
    });
  },
  setRoomDescriptionOutsideRedux(convoId: string, roomDescription: string) {
    window.inboxStore?.dispatch({
      type: 'sogsRoomInfos/setRoomDescription',
      payload: { convoId, roomDescription },
    });
  },
};

// --- sogsRoomInfo selectors (replaces ts/state/selectors/sogsRoomInfo OutsideRedux functions) ---

export function getSubscriberCountOutsideRedux(convoId: string): number {
  const state = window.inboxStore?.getState() as any;
  return state?.sogsRoomInfo?.rooms?.[convoId]?.subscribers || 0;
}

export function getCanWriteOutsideRedux(convoId: string): boolean {
  const state = window.inboxStore?.getState() as any;
  return state?.sogsRoomInfo?.rooms?.[convoId]?.canWrite || false;
}

export function getRoomDescriptionOutsideRedux(convoId: string): string {
  const state = window.inboxStore?.getState() as any;
  return state?.sogsRoomInfo?.rooms?.[convoId]?.description || '';
}

export function getModeratorsOutsideRedux(convoId: string): Array<string> {
  const state = window.inboxStore?.getState() as any;
  return state?.sogsRoomInfo?.rooms?.[convoId]?.moderators || [];
}

// --- conversations selectors (replaces ts/state/selectors/conversations OutsideRedux functions) ---

export function getCurrentlySelectedConversationOutsideRedux(): string | undefined {
  return (window.inboxStore?.getState() as any)?.conversations?.selectedConversation as
    | string
    | undefined;
}

/**
 * Approximates the count of conversations visible in the left pane.
 * Replicates the filtering logic from _getLeftPaneConversationIds in selectors/conversations.ts.
 * Accepts the raw Redux state (typed as any to avoid importing StateType from reducer.ts).
 */
export function getLeftPaneConversationIdsCount(state: any): number {
  const lookup: Record<string, any> = state?.conversations?.conversationLookup || {};
  return Object.values(lookup).filter((c: any) => {
    if (c.isBlocked) {
      return false;
    }
    if (!c.isPrivate) {
      return true;
    }
    if (!c.isApproved) {
      return false;
    }
    // hidden contacts (priority <= 0) are not shown in the left pane list
    if (c.priority != null && c.priority <= 0) {
      return false;
    }
    return true;
  }).length;
}

export function selectMemberInviteSentOutsideRedux(member: string, convoId: string): boolean {
  const state = window.inboxStore?.getState() as any;
  if (!state || !convoId || !PubKey.is03Pubkey(convoId)) {
    return false;
  }
  const members: Array<{ pubkeyHex: string; memberStatus: string }> =
    state.groups?.members?.[convoId] || [];
  return members.find(m => m.pubkeyHex === member)?.memberStatus === 'INVITE_SENT' || false;
}

// --- settings selectors (replaces ts/state/selectors/settings functions) ---

export function getShowRecoveryPhrasePrompt(state: any): boolean {
  return state?.settings?.settingsBools?.[SettingsKey.showRecoveryPhrasePrompt] || false;
}

export function getDismissedRecoveryPhrasePrompt(state: any): boolean {
  return state?.settings?.settingsBools?.[SettingsKey.dismissedRecoveryPhrasePrompt] || false;
}

export function getHideMessageRequestBannerOutsideRedux(): boolean {
  const state = window.inboxStore?.getState() as any;
  // default true (hide banner) when store not initialized
  return state?.settings?.settingsBools?.[SettingsKey.hideMessageRequests] ?? true;
}
