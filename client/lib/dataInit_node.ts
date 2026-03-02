/**
 * Library replacement for ts/data/dataInit.ts
 *
 * Instead of proxying all database calls through Electron IPC (ipcRenderer → main process → sql.ts),
 * we bind the channels object directly to the sqlNode functions in-process.
 *
 * This must be called during SessionClient.initialize(), after sqlNode.initializeSql() has
 * been called, and before any Data.* functions are used.
 */

import { channels } from '../../ts/data/channels';
import { ConfigDumpData } from '../../ts/data/configDump/configDump';
// Import the sqlNode object (not the module namespace — functions live inside this object)
import { sqlNode as sqlNodeObj } from '../../ts/node/sql';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: Array<any>) => any;

// Mirrors the channelsToMake Set in ts/data/dataInit.ts.
// 'shutdown' and 'close' are deliberately excluded: they are handled by
// SessionClient.shutdown() directly, not via the channels object.
const channelsToMake: ReadonlyArray<string> = [
  'close',
  'removeDB',
  'getPasswordHash',
  'getDBCreationTimestampMs',
  'getGuardNodes',
  'updateGuardNodes',
  'createOrUpdateItem',
  'getItemById',
  'getAllItems',
  'removeItemById',
  'getSwarmNodesForPubkey',
  'updateSwarmNodesForPubkey',
  'clearOutAllSnodesNotInPool',
  'saveConversation',
  'fetchConvoMemoryDetails',
  'getConversationById',
  'removeConversation',
  'getAllConversations',
  'getPubkeysInPublicConversation',
  'searchMessages',
  'generateSnippetsForMessages',
  'saveMessage',
  'cleanSeenMessages',
  'cleanLastHashes',
  'updateLastHash',
  'clearLastHashesForConvoId',
  'saveSeenMessageHashes',
  'emptySeenMessageHashesForConversation',
  'saveMessages',
  'removeMessage',
  'removeMessagesByIds',
  'getAllMessagesWithAttachmentsInConversationSentBefore',
  'removeAllMessagesInConversationSentBefore',
  'cleanUpExpirationTimerUpdateHistory',
  'getUnreadByConversation',
  'getUnreadDisappearingByConversation',
  'markAllAsReadByConversationNoExpiration',
  'getUnreadCountByConversation',
  'getMessageCountByType',
  'removeAllMessagesInConversation',
  'findAllMessageFromSendersInConversation',
  'findAllMessageHashesInConversation',
  'findAllMessageHashesInConversationMatchingAuthor',
  'fetchAllGroupUpdateFailedMessage',
  'getMessageCount',
  'filterAlreadyFetchedOpengroupMessage',
  'getMessagesBySenderAndSentAt',
  'getMessagesByConvoIdAndSentAt',
  'getMessageIdsFromServerIds',
  'getMessageById',
  'getMessagesById',
  'getMessagesBySentAt',
  'getMessageByServerId',
  'getExpiredMessages',
  'getOutgoingWithoutExpiresAt',
  'getNextExpiringMessage',
  'getMessagesByConversation',
  'getLastMessagesByConversation',
  'getOldestMessageIdInConversation',
  'getFirstUnreadMessageIdInConversation',
  'getFirstUnreadMessageWithMention',
  'hasConversationOutgoingMessage',
  'getSeenMessagesByHashList',
  'getLastHashBySnode',
  'getNextAttachmentDownloadJobs',
  'saveAttachmentDownloadJob',
  'resetAttachmentDownloadPending',
  'setAttachmentDownloadJobPending',
  'removeAttachmentDownloadJob',
  'removeAllAttachmentDownloadJobs',
  'removeAll',
  'removeAllConversations',
  'getMessagesWithVisualMediaAttachments',
  'getMessagesWithFileAttachments',
  // Open group v2 channels
  'getAllV2OpenGroupRooms',
  'getV2OpenGroupRoom',
  'saveV2OpenGroupRoom',
  'removeV2OpenGroupRoom',
  // Config dump channels (derived from ConfigDumpData keys)
  ...Object.keys(ConfigDumpData),
];

export function initData(): void {
  const sqlMap = sqlNodeObj as unknown as Record<string, AnyFn>;

  for (const fnName of channelsToMake) {
    const fn = sqlMap[fnName];
    if (typeof fn !== 'function') {
      // Should not happen for the core list above — log so it's visible during development.
      window?.log?.warn(`[dataInit_node] sqlNode.${fnName} is not a function, skipping`);
      continue;
    }
    (channels as Record<string, AnyFn>)[fnName] = (...args) => fn(...args);
  }

  // 'shutdown' in channels is called by Data.shutdown() — bind it to sqlNode.close()
  (channels as Record<string, AnyFn>)['shutdown'] = () => sqlNodeObj.close();

  // 'removeOtherData' / 'cleanupOrphanedAttachments' are process-level cleanup ops
  // not represented as single SQL calls. Bind as best-effort no-ops in library mode.
  (channels as Record<string, AnyFn>)['removeOtherData'] = async () => {
    window?.log?.warn('[dataInit_node] removeOtherData called — no-op in library mode');
  };
  (channels as Record<string, AnyFn>)['cleanupOrphanedAttachments'] = async () => {
    window?.log?.warn('[dataInit_node] cleanupOrphanedAttachments called — no-op in library mode');
  };
}
