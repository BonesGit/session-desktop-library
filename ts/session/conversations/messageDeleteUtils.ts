/**
 * Pure backend message-deletion utilities extracted from ts/interactions/ so the library
 * build can import them without pulling in React/component dependencies.
 *
 * ts/interactions/conversationInteractions.ts and
 * ts/interactions/conversations/unsendingInteractions.ts re-export from here for
 * backward-compatibility with the desktop app.
 */

import { GroupPubkeyType, PubkeyType } from 'libsession_util_nodejs';
import { compact, isEmpty } from 'lodash';
import { Data } from '../../data/data';
import { ConversationModel } from '../../models/conversation';
import { MessageModel } from '../../models/message';
import { SnodeAPI } from '../apis/snode_api/SNodeAPI';
import { ConvoHub } from '../conversations';
import { PubKey } from '../types';
import { UserUtils } from '../utils';
import { ed25519Str } from '../utils/String';
import { WithLocalMessageDeletionType } from '../types/with';
import { conversationReset } from '../../state/ducks/conversations';

// ---------------------------------------------------------------------------
// Private helpers (shared between the two exported functions)
// ---------------------------------------------------------------------------

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every(val => typeof val === 'string');
}

function getMessageHashes(messages: Array<MessageModel>): Array<string> {
  return compact(messages.map(m => m.get('messageHash')));
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Delete all messages in a conversation locally (no swarm interaction, no confirmation dialog).
 * Extracted from conversationInteractions.ts to avoid a component/React dependency chain.
 */
export async function deleteAllMessagesByConvoIdNoConfirmation(conversationId: string) {
  const conversation = ConvoHub.use().get(conversationId);
  await Data.removeAllMessagesInConversation(conversationId);

  // destroy message keeps the active timestamp set so the conversation still
  // appears on the conversation list but is empty
  conversation.setLastMessage(null);
  conversation.setLastMessageInteraction(null);

  await conversation.commit();
  window.inboxStore?.dispatch(conversationReset(conversationId));
}

/**
 * Deletes a message completely or marks it as deleted only. Does not interact with the swarm.
 */
export async function deleteMessagesLocallyOnly({
  conversation,
  messages,
  deletionType,
}: WithLocalMessageDeletionType & {
  conversation: ConversationModel;
  messages: Array<MessageModel>;
}) {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (deletionType === 'complete') {
      // eslint-disable-next-line no-await-in-loop
      await conversation.removeMessage(message.id);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await message.markAsDeleted();
    }
  }
  conversation.updateLastMessage();
}

/**
 * Delete messages from swarm and completely remove them locally.
 * Extracted from unsendingInteractions.ts to avoid component/React dependency chain.
 */
export async function deleteMessagesFromSwarmAndCompletelyLocally(
  conversation: ConversationModel,
  messages: Array<MessageModel>
) {
  const pubkey = conversation.isPrivate() ? UserUtils.getOurPubKeyStrFromCache() : conversation.id;
  if (!PubKey.is03Pubkey(pubkey) && !PubKey.is05Pubkey(pubkey)) {
    throw new Error('deleteMessagesFromSwarmAndCompletelyLocally needs a 03 or 05 pk');
  }
  if (PubKey.is05Pubkey(pubkey) && pubkey !== UserUtils.getOurPubKeyStrFromCache()) {
    window.log.warn(
      'deleteMessagesFromSwarmAndCompletelyLocally with 05 pk can only delete for ourself'
    );
    return;
  }
  if (conversation.isClosedGroup() && PubKey.is05Pubkey(pubkey)) {
    window.log.info('Cannot delete message from a closed group swarm, so we just complete delete.');
    await deleteMessagesLocallyOnly({ conversation, messages, deletionType: 'complete' });
    return;
  }
  window.log.info(
    'Deleting from swarm of ',
    ed25519Str(pubkey),
    ' hashes: ',
    messages.map(m => m.get('messageHash'))
  );
  const deletedFromSwarm = await deleteMessagesFromSwarmOnly(messages, pubkey);
  if (!deletedFromSwarm) {
    window.log.warn(
      'deleteMessagesFromSwarmAndCompletelyLocally: some messages failed to be deleted. Maybe they were already deleted?'
    );
  }
  await deleteMessagesLocallyOnly({ conversation, messages, deletionType: 'complete' });
}

/**
 * Delete messages from swarm and mark them as deleted locally (keep entry in DB).
 * Extracted from unsendingInteractions.ts to avoid component/React dependency chain.
 */
export async function deleteMessagesFromSwarmAndMarkAsDeletedLocally(
  conversation: ConversationModel,
  messages: Array<MessageModel>
) {
  if (conversation.isClosedGroup() && PubKey.is05Pubkey(conversation.id)) {
    window.log.info(
      'Cannot delete messages from a legacy closed group swarm, so we just markDeleted.'
    );
    await deleteMessagesLocallyOnly({ conversation, messages, deletionType: 'markDeleted' });
    return;
  }
  const pubkeyToDeleteFrom = PubKey.is03Pubkey(conversation.id)
    ? conversation.id
    : UserUtils.getOurPubKeyStrFromCache();
  const deletedFromSwarm = await deleteMessagesFromSwarmOnly(messages, pubkeyToDeleteFrom);
  if (!deletedFromSwarm) {
    window.log.warn(
      'deleteMessagesFromSwarmAndMarkAsDeletedLocally: some messages failed to be deleted but still removing the messages content... '
    );
  }
  await deleteMessagesLocallyOnly({ conversation, messages, deletionType: 'markDeleted' });
}

/**
 * Do a single request to the swarm with all the message hashes to delete from the swarm.
 * Does not delete anything locally.
 * Returns true if no errors happened, false if an error happened.
 * Extracted from unsendingInteractions.ts to avoid a component/React dependency chain.
 */
export async function deleteMessagesFromSwarmOnly(
  messages: Array<MessageModel> | Array<string>,
  pubkey: PubkeyType | GroupPubkeyType
) {
  const deletionMessageHashes = isStringArray(messages) ? messages : getMessageHashes(messages);

  try {
    if (isEmpty(messages)) {
      return false;
    }

    if (!deletionMessageHashes.length) {
      window.log?.warn(
        'deleteMessagesFromSwarmOnly: We do not have hashes for some of those messages'
      );
      return false;
    }
    const hashesAsSet = new Set(deletionMessageHashes);
    if (PubKey.is03Pubkey(pubkey)) {
      return await SnodeAPI.networkDeleteMessagesForGroup(hashesAsSet, pubkey);
    }
    return await SnodeAPI.networkDeleteMessageOurSwarm(hashesAsSet, pubkey);
  } catch (e) {
    window.log?.error(
      `deleteMessagesFromSwarmOnly: Error deleting message from swarm of ${ed25519Str(pubkey)}, hashes: ${deletionMessageHashes}`,
      e
    );
    return false;
  }
}
