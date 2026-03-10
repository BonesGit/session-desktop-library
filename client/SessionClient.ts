/**
 * SessionClient — headless Node.js API for the Session protocol.
 *
 * Initialization order:
 *  1. installWindowShim()          — global.window must exist before any backend import
 *  2. sqlNode.initializeSql()      — open / create the encrypted SQLite database
 *  3. initData()                   — bind channels → sqlNode (no IPC)
 *  4. Storage.fetch()              — load key-value settings from DB
 *  5. initializeAttachmentLogic()  — set up attachment directories
 *  6. LibSessionUtil.initializeLibSessionUtilWrappers() — native crypto
 *  7. BlockedNumberController.load()
 *  8. ConvoHub.use().load()        — load all conversations from DB
 *  9. SwarmPolling                 — start polling for new messages
 * 10. DisappearingMessages         — schedule expiry timers
 */

import { EventEmitter, on as eventsOn } from 'events';
import type {
  SessionClientConfig,
  Message,
  Conversation,
  Attachment,
  SendMessageOptions,
  SendAttachmentOptions,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyValue = any;

export class SessionClient extends EventEmitter {
  private _config: SessionClientConfig;
  private _initialized = false;
  private _sessionId: string | null = null;
  // Tracks message IDs already emitted as message:received to prevent duplicates.
  // The Notifications patch and the conversationChanged fallback both write here.
  private readonly _emittedMessageIds = new Set<string>();
  // Only emit messages that arrived after initialize() was called (skip historical messages).
  private _initTime = 0;

  constructor(config: SessionClientConfig) {
    super();
    this.setMaxListeners(50);
    this._config = config;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the client. Must be called before anything else.
   * Sets up the database, crypto wrappers, and network poller.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      throw new Error('SessionClient.initialize() has already been called');
    }

    // Step 1: Install global.window shim BEFORE any backend module loads
    const { installWindowShim } = await import('./lib/globalShim');
    installWindowShim(this._config);

    const { internalEmitter } = await import('./lib/internalEmitter');

    // Bridge internal emitter events → public SessionClient events
    internalEmitter.on('message:received', (msg: Message) => this.emit('message:received', msg));
    internalEmitter.on('conversation:updated', (convo: Conversation) =>
      this.emit('conversation:updated', convo)
    );

    // Step 2: Initialize SQLCipher database
    const { sqlNode } = await import('../ts/node/sql');
    await sqlNode.initializeSql({
      configDir: this._config.dataPath,
      key: this._config.password ?? '',
      passwordAttempt: false,
    });

    // Step 3: Bind channels → sqlNode (no Electron IPC)
    const { initData } = await import('./lib/dataInit_node');
    initData();

    // Step 4: Load key-value settings from DB
    const { Storage } = await import('../ts/util/storage');
    await Storage.fetch();

    // Step 5: Initialize attachment file paths
    const { initializeAttachmentLogic } = await import('../ts/types/MessageAttachment');
    await initializeAttachmentLogic(this._config.dataPath);

    // Step 5b: Generate the local attachment encryption key if this is a fresh install.
    // Without this, processNewAttachment() throws "needs a key set in local_attachment_encrypted_key".
    const { Data: DataForKey } = await import('../ts/data/data');
    await DataForKey.generateAttachmentKeyIfEmpty();

    // Check if an account already exists — needed to guard crypto wrapper init below.
    // We check the number_id key directly (set by createAccount) rather than
    // Registration.isDone() (set by registrationDone) because old DBs created before
    // the fix for restoreAccount may have the identity key stored but not
    // chromiumRegistrationDone. Falling back to just the pubkey presence is safe.
    const { getOurPubKeyStrFromCache } = await import('../ts/session/utils/User');
    try {
      this._sessionId = getOurPubKeyStrFromCache();
    } catch {
      // No account yet — session ID will be set after createAccount/restoreAccount
    }

    // Step 6: Initialize libsession native crypto wrappers — only when an account exists.
    // initializeLibSessionUtilWrappers() reads the user keypair from the DB; calling it
    // on a fresh install (no keypair yet) throws "user has no keypair".
    // createAccount() / restoreAccount() will call _initLibSession() after registration.
    if (this._sessionId) {
      await this._initLibSession();
    }

    // Step 7: Load blocked numbers
    const { BlockedNumberController } = await import('../ts/util/blockedNumberController');
    await BlockedNumberController.load();

    // Step 8: Load all conversations
    const { ConvoHub } = await import('../ts/session/conversations');
    await ConvoHub.use().load();

    // Record the time we start listening so we don't re-emit pre-existing messages.
    // Set early (before polling starts) so no arriving message is missed.
    this._initTime = Date.now();
    const { Data } = await import('../ts/data/data');
    const self = this;

    // Gap 1: Patch Notifications.addNotification to fire library events instead of
    // trying to use the browser Notification API (which doesn't exist in Node.js).
    // conversation.notify() calls this after all approval/mention checks pass —
    // this fires for approved contacts and for the first message from a new contact
    // when there are no prior pending requests.
    const { Notifications } = await import('../ts/util/notifications');
    (Notifications as AnyValue).addNotification = async (notif: AnyValue) => {
      if (notif.messageId && notif.conversationId) {
        try {
          const msg = await Data.getMessageById(notif.messageId);
          if (msg && !self._emittedMessageIds.has(msg.id as string)) {
            self._emittedMessageIds.add(msg.id as string);
            internalEmitter.emit('message:received', self._mapMessage(msg));
            const convo = ConvoHub.use().get(notif.conversationId);
            if (convo) {
              internalEmitter.emit('conversation:updated', self._mapConversation(convo));
            }
          }
        } catch (e) {
          window?.log?.warn('[session-lib] addNotification hook error:', e);
        }
      }
    };

    // Gap 2 + Gap 1 fallback: The stub store re-emits every Redux dispatch on
    // internalEmitter. We use conversationsChanged (plural — payload is an array)
    // dispatched by conversation.commit() to:
    //   a) Forward conversation metadata updates to library consumers.
    //   b) Catch incoming messages that notify() filtered out (e.g. messages from
    //      unapproved contacts). These never reach Notifications.addNotification,
    //      so we fetch the latest message directly from the DB.
    internalEmitter.on('redux:dispatch', async (action: AnyValue) => {
      if (
        action.type === 'conversations/conversationsChanged' &&
        Array.isArray(action.payload)
      ) {
        for (const convoData of action.payload as AnyValue[]) {
          const convoId = convoData.id as string;
          if (!convoId) continue;

          try {
            const convo = ConvoHub.use().get(convoId);
            if (convo) {
              self.emit('conversation:updated', self._mapConversation(convo));
            }
          } catch {
            // Ignore — conversation may have been deleted
          }

          // Fallback: emit any recent incoming message that wasn't caught by the
          // Notifications patch (e.g. from an unapproved contact).
          try {
            const msgs = await Data.getLastMessagesByConversation(convoId, 1, false);
            const latest = msgs[0];
            if (
              latest &&
              (latest.get('type') as string) === 'incoming' &&
              ((latest.get('received_at') as number) ?? 0) >= self._initTime &&
              !self._emittedMessageIds.has(latest.id as string)
            ) {
              self._emittedMessageIds.add(latest.id as string);
              self.emit('message:received', self._mapMessage(latest));
            }
          } catch {
            // Ignore DB errors in the fallback path
          }
        }
      }
    });

    // Step 9: Load group meta-dumps from DB so meta wrappers are initialized BEFORE SwarmPolling
    // starts. SwarmPolling.pollForAllKeys() calls notPollingForGroupAsNotInWrapper() which deletes
    // any group whose meta wrapper isn't initialized. loadMetaDumpsFromDB must run first.
    if (this._sessionId) {
      const { groupInfoActions } = await import('../ts/state/ducks/metaGroups');
      const stubStore = (global as AnyValue).window.inboxStore;
      const loadFn = groupInfoActions.loadMetaDumpsFromDB();
      await loadFn(stubStore.dispatch, stubStore.getState, undefined);
    }

    // Step 9b: Initialize all persisted job runners (load pending jobs from DB, start processing).
    // The desktop does this in main_renderer.tsx after polling starts. Without this, any call to
    // runner.addJob() (e.g. scheduleGroupInviteJobs inside createGroup) throws
    // "persisted job runner was not initlized yet".
    const { runners } = await import('../ts/session/utils/job_runners/JobRunner');
    for (const runner of Object.values(runners)) {
      await (runner as AnyValue).loadJobsFromDb();
      (runner as AnyValue).startProcessing();
    }

    // Step 9c: Start swarm polling (only if we have an account). Must be after loadMetaDumpsFromDB
    // so all group meta wrappers are initialized before the first poll cycle runs.
    if (this._sessionId) {
      await this._startPolling();
    }

    // Step 10: Start disappearing message expiry timers
    const { DisappearingMessages } = await import('../ts/session/disappearing_messages');
    DisappearingMessages.initExpiringMessageListener();

    this._initialized = true;
    this.emit('ready');
  }

  private async _initLibSession(): Promise<void> {
    const { LibSessionUtil } = await import('../ts/session/utils/libsession/libsession_utils');
    await LibSessionUtil.initializeLibSessionUtilWrappers();
  }

  private async _startPolling(): Promise<void> {
    const { getSwarmPollingInstance } = await import('../ts/session/apis/snode_api');
    getSwarmPollingInstance().start();
  }

  /**
   * Gracefully shut down the client and close the database.
   */
  async shutdown(): Promise<void> {
    // Stop SwarmPolling first so no timers fire after the DB is closed.
    // If polling was never started (e.g. no account) this is a no-op.
    try {
      const { getSwarmPollingInstance } = await import(
        '../ts/session/apis/snode_api/swarmPolling'
      );
      getSwarmPollingInstance().stop();
    } catch (e) {
      window?.log?.warn('[session-lib] shutdown: error stopping SwarmPolling:', e);
    }
    const { Data } = await import('../ts/data/data');
    try {
      await Data.shutdown();
    } catch (e) {
      window?.log?.warn('[session-lib] shutdown error:', e);
    }
    this.emit('shutdown');
  }

  // ---------------------------------------------------------------------------
  // Account management
  // ---------------------------------------------------------------------------

  /**
   * Generate a new BIP39-style mnemonic for account creation.
   */
  static async generateMnemonic(): Promise<string> {
    // Import only the minimal crypto primitives needed — avoids importing
    // accountManager which transitively loads JobRunner (and its module-level
    // PersistedJobRunner singletons that call window?.log before the shim runs).
    const [{ getSodiumRenderer }, { toHex }, { mnEncode }] = await Promise.all([
      import('../ts/session/crypto'),
      import('../ts/session/utils/String'),
      import('../ts/session/crypto/mnemonic'),
    ]);
    const seed = (await getSodiumRenderer()).randombytes_buf(16);
    return mnEncode(toHex(seed));
  }

  /**
   * Create a brand-new Session account from a mnemonic.
   * Returns the Session ID (65-char hex starting with '05').
   */
  async createAccount(mnemonic: string, displayName: string): Promise<string> {
    this._assertInitialized();
    const { registerSingleDevice, registrationDone } = await import('../ts/util/accountManager');
    let pubkey = '';
    await registerSingleDevice(mnemonic, 'english', displayName, async (pk: string) => {
      pubkey = pk;
      await registrationDone(pk, displayName);
    });
    this._sessionId = pubkey;
    await this._initLibSession();
    await this._startPolling();
    return pubkey;
  }

  /**
   * Restore an existing Session account from a mnemonic.
   * Fetches display name from the network.
   * Returns the Session ID.
   */
  async restoreAccount(mnemonic: string): Promise<string> {
    this._assertInitialized();
    const { signInByLinkingDevice } = await import('../ts/util/accountManager');
    const { pubKeyString } = await signInByLinkingDevice(mnemonic, 'english');

    // signInByLinkingDevice deliberately defers registration completion
    // (it expects the configurationMessageReceived event to fire registrationDone()).
    // In library mode there is no UI event loop, so we mark registration here.
    const { Storage } = await import('../ts/util/storage');
    const { Registration } = await import('../ts/util/registration');
    await Storage.put('primaryDevicePubKey', pubKeyString);
    await Registration.markDone();

    this._sessionId = pubKeyString;
    await this._initLibSession();
    await this._startPolling();
    return pubKeyString;
  }

  /**
   * Returns the current account's Session ID, or null if not registered.
   */
  getSessionId(): string | null {
    return this._sessionId;
  }

  /**
   * Returns the recovery mnemonic for the current account.
   * 
   * TODO: delete this, shouldn't need it
   */
  /*
  async getRecoveryMnemonic(): Promise<string | null> {
    this._assertInitialized();
    const { Storage } = await import('../ts/util/storage');
    return (Storage.get('mnemonic') as string | undefined) ?? null;
  }
*/

  /**
   * Returns whether an account is registered on this client.
   */
  isRegistered(): boolean {
    return this._sessionId !== null;
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /**
   * Get all conversations as a plain-object array.
   */
  async getConversations(): Promise<Array<Conversation>> {
    this._assertInitialized();
    const { ConvoHub } = await import('../ts/session/conversations');
    const convos = ConvoHub.use().getConversations();
    return convos.map((c: AnyValue) => this._mapConversation(c));
  }

  /**
   * Get a single conversation by its ID (Session ID or group pubkey).
   */
  async getConversation(id: string): Promise<Conversation | null> {
    this._assertInitialized();
    const { ConvoHub } = await import('../ts/session/conversations');
    const convo = ConvoHub.use().get(id);
    return convo ? this._mapConversation(convo) : null;
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a text message (and optionally attachments) to a Session ID or group.
   * Returns the network timestamp used as the message's ID.
   */
  async sendMessage(
    to: string,
    body: string,
    options: SendMessageOptions = {}
  ): Promise<string> {
    this._assertInitialized();
    const { ConvoHub } = await import('../ts/session/conversations');
    const { ConversationTypeEnum } = await import('../ts/models/types');

    // Session IDs start with '05' and are 66 hex chars; group pubkeys start with '03'
    const isPrivate = to.startsWith('05') && to.length === 66;
    const convoType = isPrivate ? ConversationTypeEnum.PRIVATE : ConversationTypeEnum.GROUPV2;

    const convo: AnyValue = await ConvoHub.use().getOrCreateAndWait(to, convoType);

    const quote = options.quote
      ? {
          id: options.quote.id,
          author: options.quote.author,
          text: options.quote.text,
          timestamp: Number(options.quote.id),
          attachments: [] as AnyValue[],
          referencedMessageNotFound: false,
        }
      : undefined;

    // Gap 3: Process attachments — write each file to the attachments directory so
    // the conversation model's job queue can read and upload them.
    const processedAttachments =
      options.attachments && options.attachments.length > 0
        ? await Promise.all(options.attachments.map(a => this._processAttachmentForSend(a)))
        : [];

    await (convo as AnyValue).sendMessage({
      body,
      attachments: processedAttachments,
      preview: [],
      quote,
      expireTimer: options.expireTimer ?? 0,
    });

    return String(Date.now());
  }

  /**
   * Get the most recent messages for a conversation.
   */
  async getMessages(
    conversationId: string,
    options: { limit?: number } = {}
  ): Promise<Array<Message>> {
    this._assertInitialized();
    const { Data } = await import('../ts/data/data');
    const msgs = await Data.getLastMessagesByConversation(
      conversationId,
      options.limit ?? 50,
      false
    );
    return msgs.map((m: AnyValue) => this._mapMessage(m));
  }

  /**
   * Send an emoji reaction to a message.
   * Use `msg.dbId` (the raw database UUID) as the `messageDbId` argument.
   *
   * @param conversationId - Session ID or group pubkey the message belongs to
   * @param messageDbId    - The `dbId` field from the Message object (NOT `msg.id`)
   * @param emoji          - Emoji character to react with, e.g. '👍'
   */
  async sendReaction(conversationId: string, messageDbId: string, emoji: string): Promise<void> {
    this._assertInitialized();

    const [{ ConvoHub }, { Data }, userModule] = await Promise.all([
      import('../ts/session/conversations'),
      import('../ts/data/data'),
      import('../ts/session/utils/User') as AnyValue,
    ]);
    const getOurPubKeyStrFromCache: AnyValue = (userModule as AnyValue).getOurPubKeyStrFromCache;

    const convo: AnyValue = ConvoHub.use().get(conversationId);
    if (!convo) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const sourceMessage: AnyValue = await Data.getMessageById(messageDbId);
    if (!sourceMessage) {
      throw new Error(`Message not found: ${messageDbId}`);
    }

    const us = (getOurPubKeyStrFromCache as AnyValue)();
    await convo.sendReaction(messageDbId, {
      id: sourceMessage.get('sent_at') as number,
      author: (sourceMessage.get('source') as string) || us,
      emoji,
      action: 0, // Action.REACT
    });
  }

  /**
   * Async iterator that yields new incoming messages in real-time.
   *
   * @example
   * for await (const msg of client.messages()) {
   *   console.log(msg.source, msg.body);
   * }
   */
  async *messages(): AsyncIterable<Message> {
    for await (const [msg] of eventsOn(this, 'message:received')) {
      yield msg as Message;
    }
  }

  /**
   * Async iterator that yields conversation objects whenever they are updated.
   */
  async *conversations(): AsyncIterable<Conversation> {
    for await (const [convo] of eventsOn(this, 'conversation:updated')) {
      yield convo as Conversation;
    }
  }

  /**
   * Send a typing indicator to a 1:1 conversation.
   * Only supported for private conversations — groups don't support typing indicators.
   *
   * @param conversationId - The Session ID of the contact.
   * @param isTyping - true = started typing, false = stopped typing.
   */
  async setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    this._assertInitialized();

    const { ConvoHub } = await import('../ts/session/conversations');
    const convo: AnyValue = ConvoHub.use().get(conversationId);
    if (!convo) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    if (!convo.isPrivate?.()) {
      throw new Error('Typing indicators are only supported for private (1:1) conversations');
    }

    const [
      { TypingMessage },
      { MessageQueue },
      { NetworkTime },
      { PubKey },
      { SnodeNamespaces },
      { v4: uuidV4 },
    ] = await Promise.all([
      import('../ts/session/messages/outgoing/controlMessage/TypingMessage'),
      import('../ts/session/sending/MessageQueue'),
      import('../ts/util/NetworkTime'),
      import('../ts/session/types/PubKey'),
      import('../ts/session/apis/snode_api/namespaces'),
      import('uuid'),
    ]);

    const typingMessage = new TypingMessage({
      createAtNetworkTimestamp: NetworkTime.now(),
      isTyping,
      dbMessageIdentifier: uuidV4(),
    });

    await MessageQueue.use().sendTo1o1NonDurably({
      pubkey: new PubKey(conversationId),
      message: typingMessage,
      namespace: SnodeNamespaces.Default,
    });
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  /**
   * Leave an existing closed group.
   */
  async leaveGroup(groupId: string): Promise<void> {
    this._assertInitialized();
    const { ConvoHub } = await import('../ts/session/conversations');
    const convo: AnyValue = ConvoHub.use().get(groupId);
    if (!convo) {
      throw new Error(`Group not found: ${groupId}`);
    }
    if (groupId.startsWith('03')) {
      // GroupV2: use ConvoHub.deleteGroup() with leave semantics.
      // If the first attempt fails because we're the last admin but the MetaGroup
      // wrapper has no encryption keys (broken/previously-left group state), free
      // the wrapper so the retry sees metaGroupWrapperExists=false and skips the
      // admin network-push block, falling through to local cleanup directly.
      const doDelete = async () =>
        ConvoHub.use().deleteGroup(groupId as AnyValue, {
          sendLeaveMessage: false,
          fromSyncMessage: false,
          deletionType: 'doNotKeep',
          deleteAllMessagesOnSwarm: false,
          forceDestroyForAllMembers: false,
          clearFetchedHashes: true,
        });
      try {
        await doDelete();
      } catch (firstErr: AnyValue) {
        window?.log?.info(
          `[session-lib] leaveGroup: first attempt failed (${firstErr?.message}), retrying after freeing wrapper`
        );
        try {
          const { MetaGroupWrapperActions } = await import(
            '../ts/webworker/workers/browser/libsession_worker_interface'
          );
          await MetaGroupWrapperActions.free(groupId as AnyValue);
        } catch {
          // already freed or never existed — ignore
        }
        await doDelete();
      }
    } else {
      // GroupV1 (legacy)
      await convo.leaveClosedGroup();
    }
  }

  /**
   * Create a new closed group (GroupV2). Returns the group's public key (03-prefix).
   * Sends invites to all specified members.
   */
  async createGroup(name: string, memberSessionIds: Array<string>): Promise<string> {
    this._assertInitialized();
    if (!this._sessionId) {
      throw new Error('Not registered — call createAccount() or restoreAccount() first');
    }

    const { groupInfoActions } = await import('../ts/state/ducks/metaGroups');
    const stubStore = (global as AnyValue).window.inboxStore;

    // initNewGroupInWrapper is a Redux async thunk. We invoke it with the stub store's
    // dispatch/getState. It returns { groupPk, infos, members } on success.
    const thunkFn = groupInfoActions.initNewGroupInWrapper({
      groupName: name,
      members: [...memberSessionIds, this._sessionId],
      us: this._sessionId,
      inviteAsAdmin: false,
    });

    // createAsyncThunk never rejects — it catches errors and returns a rejected action.
    // We must inspect meta.requestStatus to detect failure and surface the real error.
    const result: AnyValue = await thunkFn(stubStore.dispatch, stubStore.getState, undefined);

    if (result?.meta?.requestStatus === 'rejected') {
      const errMsg =
        result.error?.message ||
        result.error?.name ||
        JSON.stringify(result.error) ||
        'unknown error';
      throw new Error(`createGroup failed: ${errMsg}`);
    }

    const groupPk = result?.payload?.groupPk as string | undefined;
    if (!groupPk) {
      throw new Error(`createGroup: thunk succeeded but returned no groupPk (payload: ${JSON.stringify(result?.payload)})`);
    }

    // Persist the group name in the conversation model's displayNameInProfile field so
    // it survives restarts. On startup, selectLibGroupNameOutsideRedux() may return
    // undefined (meta dump gets temporarily re-initialised from a fresh empty wrapper),
    // but getRealSessionUsername() falls back to c.get('displayNameInProfile'), which IS
    // stored in the conversations table and survives across runs.
    // Must be done BEFORE UserSync.pushChangesToUserSwarmIfNeeded() — the push triggers
    // background SwarmPolling which processes config messages and can modify ConvoHub
    // state, making convo.set unavailable on the returned object afterwards.
    const { ConvoHub } = await import('../ts/session/conversations');
    const convo: AnyValue = ConvoHub.use().get(groupPk);
    if (convo && typeof convo.set === 'function' && !convo.get('displayNameInProfile')) {
      convo.set({ displayNameInProfile: name });
      await convo.commit();
    }

    // initNewGroupInWrapper calls UserGroupsWrapperActions.setGroup() (in-memory only).
    // It does NOT persist the UserGroupsConfig dump to DB. Without saving it, the next
    // startup's loadMetaDumpsFromDB will see the meta dump but find the group absent from
    // the UserGroups wrapper → it deletes the meta dump → group disappears.
    // Fix: explicitly save all user config dumps (including UserGroupsConfig) to DB now.
    const { LibSessionUtil } = await import('../ts/session/utils/libsession/libsession_utils');
    await LibSessionUtil.saveDumpsToDb(this._sessionId as AnyValue);

    // Push the updated UserGroupsConfig to our own swarm so that linked devices (same
    // account on another device) can discover this new group. Without this push, the config
    // change is only saved locally and other devices never see it.
    const { UserSync } = await import('../ts/session/utils/job_runners/jobs/UserSyncJob');
    await UserSync.pushChangesToUserSwarmIfNeeded();

    return groupPk;
  }

  /**
   * Add members to an existing GroupV2 you admin.
   * New members are added WITHOUT message history (full key rotation for security).
   * Pass `withHistory: true` to grant access to prior messages instead.
   */
  async addGroupMembers(
    groupId: string,
    sessionIds: Array<string>,
    options: { withHistory?: boolean } = {}
  ): Promise<void> {
    this._assertInitialized();
    if (!this._sessionId) {
      throw new Error('Not registered — call createAccount() or restoreAccount() first');
    }

    const { groupInfoActions } = await import('../ts/state/ducks/metaGroups');
    const stubStore = (global as AnyValue).window.inboxStore;

    const thunkFn = groupInfoActions.currentDeviceGroupMembersChange({
      groupPk: groupId as AnyValue,
      addMembersWithHistory: options.withHistory ? (sessionIds as AnyValue) : [],
      addMembersWithoutHistory: options.withHistory ? [] : (sessionIds as AnyValue),
      removeMembers: [],
      alsoRemoveMessages: false,
    });

    await thunkFn(stubStore.dispatch, stubStore.getState, undefined);
  }

  /**
   * Remove members from an existing GroupV2 you admin.
   * Pass `alsoRemoveMessages: true` to delete the removed members' messages.
   */
  async removeGroupMembers(
    groupId: string,
    sessionIds: Array<string>,
    options: { alsoRemoveMessages?: boolean } = {}
  ): Promise<void> {
    this._assertInitialized();
    if (!this._sessionId) {
      throw new Error('Not registered — call createAccount() or restoreAccount() first');
    }

    const { groupInfoActions } = await import('../ts/state/ducks/metaGroups');
    const stubStore = (global as AnyValue).window.inboxStore;

    const thunkFn = groupInfoActions.currentDeviceGroupMembersChange({
      groupPk: groupId as AnyValue,
      addMembersWithHistory: [],
      addMembersWithoutHistory: [],
      removeMembers: sessionIds as AnyValue,
      alsoRemoveMessages: options.alsoRemoveMessages ?? false,
    });

    await thunkFn(stubStore.dispatch, stubStore.getState, undefined);
  }

  /**
   * Promote one or more group members to admin in a GroupV2 group.
   * You must be an admin (hold the group secret key) to call this.
   *
   * Note: The Session protocol does not support demotion — once promoted,
   * admins cannot be demoted or removed from the group (by protocol design).
   *
   * @param groupId   - The group public key (starts with '03')
   * @param memberIds - Session IDs of members to promote
   */
  async promoteGroupMembers(groupId: string, memberIds: string[]): Promise<void> {
    this._assertInitialized();
    if (!this._sessionId) {
      throw new Error('Not registered — call createAccount() or restoreAccount() first');
    }
    if (!memberIds.length) {
      throw new Error('memberIds cannot be empty');
    }

    const [
      { uniq, isEmpty },
      { ConvoHub },
      { UserGroupsWrapperActions },
      { NetworkTime },
      { getOurPubKeyStrFromCache },
      { ClosedGroup },
      { GroupUpdateMessageFactory },
      { MessageSender },
      { StoreGroupRequestFactory },
      { timeoutWithAbort },
      { DURATION },
      { GroupInvite },
    ] = await Promise.all([
      import('lodash'),
      import('../ts/session/conversations'),
      import('../ts/webworker/workers/browser/libsession_worker_interface'),
      import('../ts/util/NetworkTime'),
      import('../ts/session/utils/User') as any,
      import('../ts/session/group/closed-group'),
      import('../ts/session/messages/message_factory/group/groupUpdateMessageFactory'),
      import('../ts/session/sending'),
      import('../ts/session/apis/snode_api/factories/StoreGroupRequestFactory'),
      import('../ts/session/utils/Promise'),
      import('../ts/session/constants'),
      import('../ts/session/utils/job_runners/jobs/GroupInviteJob'),
    ]);

    const convo: AnyValue = ConvoHub.use().get(groupId);
    if (!convo) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const groupInWrapper: AnyValue = await UserGroupsWrapperActions.getGroup(groupId as AnyValue);
    if (!groupInWrapper || !groupInWrapper.secretKey || isEmpty(groupInWrapper.secretKey)) {
      throw new Error(`Not an admin of group ${groupId} (no secret key found)`);
    }

    const membersHex: AnyValue = uniq(memberIds);
    const sentAt = NetworkTime.now();
    const us = getOurPubKeyStrFromCache();

    const msgModel: AnyValue = await (ClosedGroup as AnyValue).addUpdateMessage({
      diff: { type: 'promoted', promoted: membersHex },
      expireUpdate: null,
      sender: us,
      sentAt,
      convo,
      markAlreadySent: false,
      messageHash: null,
    });

    const groupMemberChange: AnyValue = await (GroupUpdateMessageFactory as AnyValue).getPromotedControlMessage({
      adminSecretKey: groupInWrapper.secretKey,
      convo,
      groupPk: groupId,
      promoted: membersHex,
      createAtNetworkTimestamp: sentAt,
      dbMessageIdentifier: msgModel.id,
    });

    if (!groupMemberChange) {
      throw new Error('promoteGroupMembers: failed to build group change message');
    }

    const storeRequests: AnyValue = await (StoreGroupRequestFactory as AnyValue).makeGroupMessageSubRequest(
      [groupMemberChange],
      groupInWrapper
    );

    const controller = new AbortController();
    const result: AnyValue = await (timeoutWithAbort as AnyValue)(
      (MessageSender as AnyValue).sendEncryptedDataToSnode({
        destination: groupId,
        method: 'batch',
        sortedSubRequests: storeRequests,
        abortSignal: controller.signal,
        allow401s: false,
      }),
      2 * (DURATION as AnyValue).MINUTES,
      controller
    );

    if (result?.[0]?.code !== 200) {
      throw new Error(`promoteGroupMembers: swarm rejected the change (code: ${result?.[0]?.code})`);
    }

    for (const member of membersHex) {
      await (GroupInvite as AnyValue).addJob({
        groupPk: groupId,
        member,
        inviteAsAdmin: true,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  /**
   * Download a received attachment and save it to the local attachments directory.
   * Returns the local filesystem path.
   *
   * The attachment object must have url, key, and digest populated (as received
   * in incoming messages).
   */
  /**
   * Download and decrypt an attachment from the Session CDN.
   *
   * @param attachment - Attachment object from a received Message (must have url, key, digest).
   * @param destDir    - Optional directory to save the raw decrypted file into.
   *                     If provided the file is written to `<destDir>/<fileName|id|'attachment'>`
   *                     and the full absolute path is returned.
   *                     If omitted the file is stored in the library's internal
   *                     attachments.noindex directory and the relative path is returned.
   */
  async downloadAttachment(attachment: Attachment, destDir?: string): Promise<string> {
    this._assertInitialized();

    if (!attachment.url || !attachment.key || !attachment.digest) {
      throw new Error('Attachment is missing url, key, or digest — cannot download');
    }

    const { downloadAttachmentFs } = await import('../ts/receiver/attachments');

    const downloaded = await downloadAttachmentFs({
      url: attachment.url,
      id: attachment.id,
      key: attachment.key,
      digest: attachment.digest,
      size: attachment.size,
    });

    if (destDir) {
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      mkdirSync(destDir, { recursive: true });
      const fileName = attachment.fileName ?? attachment.id ?? 'attachment';
      const dest = join(destDir, fileName);
      writeFileSync(dest, Buffer.from(downloaded.data));
      return dest;
    }

    const { processNewAttachment } = await import('../ts/types/MessageAttachment');
    const stored = await processNewAttachment({
      data: downloaded.data,
      contentType: attachment.contentType,
      fileName: attachment.fileName,
    });

    return stored.path as string;
  }

  // ---------------------------------------------------------------------------
  // Profile
  // ---------------------------------------------------------------------------

  /**
   * Set the display name shown to other Session users.
   */
  async setDisplayName(name: string): Promise<void> {
    this._assertInitialized();
    const { UserConfigWrapperActions } = await import(
      '../ts/webworker/workers/browser/libsession/libsession_worker_userconfig_interface'
    );
    await UserConfigWrapperActions.setNameTruncated(name);
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /**
   * Accept an incoming contact request from the given Session ID.
   * Sends a MessageRequestResponse so the other party's client shows "accepted".
   */
  async acceptContactRequest(sessionId: string): Promise<void> {
    this._assertInitialized();
    const { ConvoHub } = await import('../ts/session/conversations');
    const convo: AnyValue = ConvoHub.use().get(sessionId);
    if (!convo) {
      throw new Error(`Contact not found: ${sessionId}`);
    }

    const previousIsApproved = convo.isApproved() as boolean;
    const previousDidApproveMe = convo.didApproveMe() as boolean;

    // Mark us as approving them (false = don't push to linked devices yet)
    await convo.setIsApproved(true, false);
    await convo.commit();

    // If they already sent us a message (didApproveMe), notify them we accepted.
    // addOutgoingApprovalMessage() and sendMessageRequestResponse() are both on
    // ConversationModel — no imports from the excluded ts/interactions/ directory needed.
    if (!previousIsApproved && previousDidApproveMe) {
      const approvalMsg = await convo.addOutgoingApprovalMessage(Date.now());
      await convo.sendMessageRequestResponse(approvalMsg);
    }
  }

  /**
   * Block a Session ID (prevents messages from them being processed).
   */
  async blockContact(sessionId: string): Promise<void> {
    this._assertInitialized();
    const { BlockedNumberController } = await import('../ts/util/blockedNumberController');
    await BlockedNumberController.block(sessionId);
  }

  /**
   * Unblock a previously blocked Session ID.
   */
  async unblockContact(sessionId: string): Promise<void> {
    this._assertInitialized();
    const { BlockedNumberController } = await import('../ts/util/blockedNumberController');
    await BlockedNumberController.unblockAll([sessionId]);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _assertInitialized(): void {
    if (!this._initialized) {
      throw new Error('SessionClient is not initialized. Call initialize() first.');
    }
  }

  /**
   * Copy a file into the Session attachments directory and return the attachment
   * descriptor expected by conversation.sendMessage({ attachments }).
   * The conversation model's job queue (message.uploadData()) will handle the
   * actual upload to the File Server.
   */
  private async _processAttachmentForSend(opts: SendAttachmentOptions): Promise<AnyValue> {
    const { readFileSync, statSync } = await import('fs');
    const { processNewAttachment } = await import('../ts/types/MessageAttachment');

    const data = readFileSync(opts.path);
    const size = statSync(opts.path).size;

    const stored = await processNewAttachment({
      data: data.buffer as ArrayBuffer,
      contentType: opts.contentType,
      fileName: opts.fileName,
    });

    return {
      ...stored,
      contentType: opts.contentType,
      fileName: opts.fileName ?? undefined,
      size,
    };
  }

  private _mapConversation(c: AnyValue): Conversation {
    return {
      id: c.id as string,
      type: c.get('type') as string,
      displayName:
        c.getRealSessionUsername?.() ?? (c.get('name') as string | undefined),
      avatarPath: c.get('avatarPath') as string | undefined,
      unreadCount: (c.get('unreadCount') as number | undefined) ?? 0,
      lastMessage: c.get('lastMessage') as string | undefined,
      lastMessageTimestamp: c.get('lastMessageTimestamp') as number | undefined,
      members: c.get('members') as Array<string> | undefined,
      expireTimer: c.get('expireTimer') as number | undefined,
      isApproved: (c.isApproved?.() as boolean) ?? true,
      isIncomingRequest: (c.isIncomingRequest?.() as boolean) ?? false,
    };
  }

  private _mapMessage(m: AnyValue): Message {
    // Map raw attachment objects, preserving the crypto fields needed for download
    const rawAttachments = m.get('attachments') as AnyValue[] | undefined;
    const attachments: Attachment[] | undefined = rawAttachments?.map(
      (a: AnyValue): Attachment => ({
        contentType: a.contentType as string,
        fileName: a.fileName as string | undefined,
        size: a.size as number | undefined,
        localPath: a.path as string | undefined,
        url: a.url as string | undefined,
        id: a.id as string | undefined,
        key: a.key as string | undefined,
        digest: a.digest as string | undefined,
      })
    );

    return {
      id: String(m.get('sent_at') ?? m.id),
      dbId: m.id as string,
      conversationId: m.get('conversationId') as string,
      source: m.get('source') as string,
      body: m.get('body') as string | undefined,
      timestamp: ((m.get('sent_at') ?? m.get('received_at') ?? 0) as number),
      isOutgoing: m.get('type') === 'outgoing',
      attachments,
      quote: m.get('quote') as AnyValue | undefined,
      expireTimer: m.get('expireTimer') as number | undefined,
      unread: m.get('unread') as boolean | undefined,
      status: m.getMessagePropStatus?.() as Message['status'] | undefined,
    };
  }
}
