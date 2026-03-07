/**
 * Pure backend conversation-request utilities extracted from ts/interactions/ so the library
 * build can import them without pulling in React/component dependencies.
 *
 * ts/interactions/conversationInteractions.ts re-exports from here for
 * backward-compatibility with the desktop app.
 */

import { UserGroupsWrapperActions } from '../../webworker/workers/browser/libsession_worker_interface';
import { getSwarmPollingInstance } from '../apis/snode_api';
import { ConvoHub } from '../conversations';
import { sendInviteResponseToGroup } from '../sending/group/GroupInviteResponse';
import { PubKey } from '../types';
import { PromiseUtils } from '../utils';
import { sleepFor } from '../utils/Promise';
import { ed25519Str } from '../utils/String';

/**
 * Accept if needed the message request from this user.
 * Note: approvalMessageTimestamp is provided to be able to insert the
 * "You've accepted the message request" at the right place.
 *
 * Extracted from conversationInteractions.ts to avoid a component/React dependency chain.
 */
export const handleAcceptConversationRequestWithoutConfirm = async ({
  convoId,
  approvalMessageTimestamp,
}: {
  convoId: string;
  approvalMessageTimestamp: number;
}) => {
  const convo = ConvoHub.use().get(convoId);
  if (!convo || convo.isApproved() || (!convo.isPrivate() && !convo.isClosedGroupV2())) {
    window?.log?.debug('Conversation is already approved or not private/03group');
    return null;
  }

  const previousIsApproved = convo.isApproved();
  const previousDidApprovedMe = convo.didApproveMe();
  // Note: we don't mark as approvedMe = true, as we do not know if they did send us a message yet.
  await convo.setIsApproved(true, false);
  await convo.commit();

  if (convo.isPrivate()) {
    // we only need the approval message (and sending a reply) when we are accepting a message
    // request. i.e. someone sent us a message already and we didn't accept it yet.
    if (!previousIsApproved && previousDidApprovedMe) {
      const msg = await convo.addOutgoingApprovalMessage(approvalMessageTimestamp);
      await convo.sendMessageRequestResponse(msg);
    }

    return null;
  }
  if (PubKey.is03Pubkey(convoId)) {
    const found = await UserGroupsWrapperActions.getGroup(convoId);
    if (!found) {
      window.log.warn('cannot approve a non existing group in user group');
      return null;
    }
    // this updates the wrapper and refresh the redux slice
    await UserGroupsWrapperActions.setGroup({ ...found, invitePending: false });

    // nothing else to do (and especially not wait for first poll) when the convo was already approved
    if (previousIsApproved) {
      return null;
    }
    const pollAndSendResponsePromise = new Promise(resolve => {
      getSwarmPollingInstance().addGroupId(convoId, async () => {
        // we need to do a first poll to fetch the keys etc before we can send our invite response
        // this is pretty hacky, but also an admin seeing a message from that user in the group
        // will mark it as not pending anymore
        await sleepFor(2000);
        if (!previousIsApproved) {
          await sendInviteResponseToGroup({ groupPk: convoId });
        }

        window.log.info(
          `handleAcceptConversationRequestWithoutConfirm: first poll for group ${ed25519Str(convoId)} happened, we should have encryption keys now`
        );
        return resolve(true);
      });
    });

    // try at most 10s for the keys, and everything to come before continuing processing.
    // Note: this is important as otherwise the polling just hangs when sending a message to a group
    // (as the cb in addGroupId() is never called back)
    const timeout = 10000;
    try {
      await PromiseUtils.timeout(pollAndSendResponsePromise, timeout);
    } catch (e) {
      window.log.warn(
        `handleAcceptConversationRequestWithoutConfirm: waited ${timeout}ms for first poll of group ${ed25519Str(convoId)} to happen, but timed out with: ${e.message}`
      );
    }
  }
  return null;
};
