/**
 * Minimal Redux-like reducer for the library stub store.
 *
 * The backend code calls window.inboxStore?.dispatch(action) and
 * window.inboxStore?.getState() for a handful of purposes:
 *
 *   1. Updating onion paths in state (read by onionPath.ts)
 *   2. Pushing quoted message details (read by queuedJob.ts)
 *   3. Showing message request banner (read by receiver code)
 *
 * All other dispatched actions are no-ops here — they are re-emitted on the
 * internalEmitter so SessionClient can surface them as public events.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export interface LibraryState {
  onionPaths: {
    snodePaths: Array<
      Array<{ ip: string; port: number; pubkey_ed25519: string; pubkey_x25519: string }>
    >;
    isOnline: boolean;
  };
  conversations: AnyRecord & { quotedMessages: Array<AnyRecord> };
  // settings.settingsBools is read by state selectors (e.g. getShowRecoveryPhrasePrompt).
  settings: {
    settingsBools: Record<string, boolean | undefined>;
  };
  // user slice — read by user selectors
  user: AnyRecord;
  // groups slice — mirrors GroupState from metaGroups.ts.
  // selectLibGroupMembersOutsideRedux / selectLibGroupAdminsOutsideRedux etc.
  // call window.inboxStore.getState().groups.members so this must always exist.
  groups: {
    infos: AnyRecord;
    members: AnyRecord;
    creationFromUIPending: boolean;
    memberChangesFromUIPending: boolean;
    nameChangesFromUIPending: boolean;
    avatarChangeFromUIPending: boolean;
    creationMembersSelected: Array<unknown>;
    creationGroupName: string;
  };
  // userGroups slice — mirrors UserGroupState from userGroups.ts.
  // getLibGroupKickedOutsideRedux calls state.userGroups.userGroups so this must exist.
  userGroups: {
    userGroups: AnyRecord;
  };
}

export function getInitialLibraryState(): LibraryState {
  return {
    onionPaths: {
      snodePaths: [],
      isOnline: true,
    },
    // Provide safe defaults for every conversations property accessed by selectors.
    // Selectors that call Object.values() / Object.keys() need non-null objects.
    conversations: {
      conversationLookup: {},
      quotedMessages: [],
      showMessageRequestBanner: false,
      messages: [],
      messageInfoId: null,
      focusedMessageId: null,
      mostRecentMessageId: null,
      firstUnreadMessageId: null,
      oldTopMessageId: null,
      oldBottomMessageId: null,
      nextMessageToPlayId: null,
      animateQuotedMessageId: null,
      selectedMessageIds: [],
      mentionMembers: [],
      isCompositionTextAreaFocused: false,
      areMoreMessagesBeingFetched: false,
      shouldHighlightMessage: false,
      showScrollButton: false,
      showRightPanel: false,
      quotedMessage: null,
    },
    settings: {
      settingsBools: {},
    },
    user: {
      ourNumber: null,
    },
    groups: {
      infos: {},
      members: {},
      creationFromUIPending: false,
      memberChangesFromUIPending: false,
      nameChangesFromUIPending: false,
      avatarChangeFromUIPending: false,
      creationMembersSelected: [],
      creationGroupName: '',
    },
    userGroups: {
      userGroups: {},
    },
  };
}

export function libraryReducer(
  state: LibraryState,
  action: { type: string; payload?: unknown }
): LibraryState {
  switch (action.type) {
    // Onion path updates — backend reads state.onionPaths.snodePaths
    case 'UPDATE_ONION_PATHS': {
      const payload = action.payload as { snodePaths?: Array<unknown> } | undefined;
      return {
        ...state,
        onionPaths: {
          ...state.onionPaths,
          snodePaths: (payload?.snodePaths ??
            state.onionPaths.snodePaths) as LibraryState['onionPaths']['snodePaths'],
        },
      };
    }

    // Quoted message details — receiver/queuedJob.ts reads these
    case 'PUSH_QUOTED_MESSAGE_DETAILS': {
      const payload = action.payload as { messageId?: string; details?: unknown } | undefined;
      if (!payload?.messageId) {
        return state;
      }
      return {
        ...state,
        conversations: {
          ...state.conversations,
          quotedMessages: {
            ...state.conversations.quotedMessages,
            [payload.messageId]: payload.details,
          },
        },
      };
    }

    // Message request banner flag
    case 'SHOW_MESSAGE_REQUEST_BANNER_OUTSIDE_REDUX':
      return {
        ...state,
        conversations: {
          ...state.conversations,
          showMessageRequestBanner: true,
        },
      };

    // userGroups slice — mirror userGroupReducer so selectors like getLibGroupKickedOutsideRedux
    // can safely access state.userGroups.userGroups without throwing.
    case 'userGroup/refreshUserGroupDetails': {
      const g = (action.payload as { group?: { pubkeyHex?: string } } | undefined)?.group;
      if (g?.pubkeyHex) {
        return {
          ...state,
          userGroups: {
            userGroups: { ...state.userGroups.userGroups, [g.pubkeyHex]: g },
          },
        };
      }
      return state;
    }

    case 'userGroup/refreshUserGroupsSlice': {
      const groups = (action.payload as { groups?: Array<{ pubkeyHex: string }> } | undefined)
        ?.groups;
      if (Array.isArray(groups)) {
        const map: AnyRecord = {};
        groups.forEach(g => {
          map[g.pubkeyHex] = g;
        });
        return { ...state, userGroups: { userGroups: map } };
      }
      return state;
    }

    case 'userGroup/deleteUserGroupDetails': {
      const pk = (action.payload as { group?: { pubkey?: string } } | undefined)?.group?.pubkey;
      if (pk) {
        const next = { ...state.userGroups.userGroups };
        delete next[pk];
        return { ...state, userGroups: { userGroups: next } };
      }
      return state;
    }

    // Group slice — mirror groupReducer so that selectors reading state.groups.infos /
    // state.groups.members (e.g. selectLibGroupMembersOutsideRedux) find live data.
    // These fulfilled actions carry { groupPk, infos, members } in their payload.
    // loadMetaDumpsFromDB returns Array<{groupPk, infos, members}> — different shape
    case 'group/loadMetaDumpsFromDB/fulfilled': {
      const list = action.payload as
        | Array<{ groupPk?: string; infos?: unknown; members?: unknown }>
        | undefined;
      if (!Array.isArray(list) || list.length === 0) return state;
      const newInfos = { ...state.groups.infos };
      const newMembers = { ...state.groups.members };
      for (const p of list) {
        if (p?.groupPk && p.infos && p.members) {
          newInfos[p.groupPk] = p.infos;
          newMembers[p.groupPk] = p.members;
        }
      }
      return { ...state, groups: { ...state.groups, infos: newInfos, members: newMembers } };
    }

    case 'group/initNewGroupInWrapper/fulfilled':
    case 'group/handleUserGroupUpdate/fulfilled':
    case 'group/currentDeviceGroupMembersChange/fulfilled':
    case 'group/refreshGroupDetailsFromWrapper/fulfilled':
    case 'group/currentDeviceGroupNameChange/fulfilled':
    case 'group/currentDeviceGroupAvatarChange/fulfilled':
    case 'group/currentDeviceGroupAvatarRemoval/fulfilled':
    case 'group/inviteResponseReceived/fulfilled':
    case 'group/handleMemberLeftMessage/fulfilled': {
      const p = action.payload as
        | { groupPk?: string; infos?: unknown; members?: unknown }
        | undefined;
      if (p?.groupPk && p.infos && p.members) {
        return {
          ...state,
          groups: {
            ...state.groups,
            infos: { ...state.groups.infos, [p.groupPk]: p.infos },
            members: { ...state.groups.members, [p.groupPk]: p.members },
          },
        };
      }
      return state;
    }

    default:
      return state;
  }
}
