# SessionClient — Skill Reference

## Overview

`SessionClient` is a headless Node.js API for the Session decentralized messaging protocol.
It provides 1:1 DMs, closed group (GroupV2) chats, attachment sending/receiving, contact management, and real-time message streaming — all without any UI or Electron dependency.

Built from: `session-desktop-library` (`client/SessionClient.ts`)

---

## Quick Start

```typescript
import { SessionClient } from 'session-desktop-library';

const client = new SessionClient({ dataPath: '/path/to/data' });
await client.initialize();

// First run: create or restore an account
const mnemonic = await SessionClient.generateMnemonic();
const sessionId = await client.createAccount(mnemonic, 'Alice');

// Subsequent runs: account is loaded automatically from the DB
// (no need to restore — just initialize())
const sessionId = client.getSessionId(); // already set if DB has an account

// Send a message
await client.sendMessage('05abc...66hex', 'Hello!');

// Stream incoming messages
for await (const msg of client.messages()) {
  console.log(msg.source, msg.body);
}
```

---

## Configuration

```typescript
const client = new SessionClient({
  dataPath: '/path/to/data',  // Required. SQLite DB, keys, attachments stored here.
  password: 'optional',       // SQLCipher encryption password (default: none)
  logLevel: 'warn',           // 'trace'|'debug'|'info'|'warn'|'error'|'fatal'|'silent'
  logger: pinoInstance,       // Custom pino logger (overrides logLevel)
  seedNodes: ['https://...'], // Override bootstrap seed node URLs
  featureFlags: { ... },      // Override Session feature flags
});
```

---

## Lifecycle

### `await client.initialize()`
Must be called first. Opens the database, loads crypto wrappers, starts network polling.
If an account already exists in the DB, the client is immediately ready to send/receive.

### `await client.shutdown()`
Stops network polling and closes the database. Always call before process exit.

---

## Account Management

### `SessionClient.generateMnemonic(): Promise<string>` (static)
Generate a new 13-word BIP39-compatible mnemonic. Use with `createAccount()`.

### `await client.createAccount(mnemonic, displayName): Promise<string>`
Create a brand-new Session account. Returns the Session ID (`05`-prefixed 66-char hex).
Stores the keypair in the local DB — mnemonic is only needed once.

### `await client.restoreAccount(mnemonic): Promise<string>`
Restore an existing account from its mnemonic. Returns the Session ID.
Stores the keypair in the local DB — mnemonic is only needed once.

### `client.getSessionId(): string | null`
Returns the current account's Session ID, or `null` if not registered.

### `client.isRegistered(): boolean`
Returns whether an account is loaded.

---

## Messaging

### `await client.sendMessage(to, body, options?): Promise<string>`
Send a text message (and optionally attachments) to a Session ID or group public key.
Returns a timestamp string used as the message ID.

```typescript
// Simple text
await client.sendMessage('05abc...', 'Hello!');

// With attachment
await client.sendMessage('05abc...', 'See this', {
  attachments: [{ path: '/tmp/photo.jpg', contentType: 'image/jpeg', fileName: 'photo.jpg' }],
});

// With quote
await client.sendMessage('05abc...', 'Good point', {
  quote: { id: msg.timestamp, author: msg.source, text: msg.body },
});

// With disappearing timer (seconds)
await client.sendMessage('05abc...', 'Self-destructing', { expireTimer: 60 });
```

`to` can be:
- A 1:1 Session ID: `05` + 64 hex chars
- A GroupV2 public key: `03` + 64 hex chars

### `await client.getMessages(conversationId, options?): Promise<Message[]>`
Get recent messages for a conversation, newest first.

```typescript
const msgs = await client.getMessages('05abc...', { limit: 20 });
```

### `async *client.messages(): AsyncIterable<Message>`
Real-time stream of all incoming messages across all conversations.

```typescript
for await (const msg of client.messages()) {
  console.log(`[${msg.conversationId}] ${msg.source}: ${msg.body}`);
  if (msg.attachments?.length) {
    const path = await client.downloadAttachment(msg.attachments[0], '/tmp/downloads');
    console.log('saved to', path);
  }
}
```

---

## Conversations

### `await client.getConversations(): Promise<Conversation[]>`
Get all conversations (DMs and groups).

```typescript
const convos = await client.getConversations();
const groups = convos.filter(c => c.id.startsWith('03'));
const dms    = convos.filter(c => c.id.startsWith('05'));
const pending = convos.filter(c => c.isIncomingRequest);
```

### `await client.getConversation(id): Promise<Conversation | null>`
Get a single conversation by ID.

### `async *client.conversations(): AsyncIterable<Conversation>`
Real-time stream of conversation updates (metadata changes, new messages, etc.).

---

## Groups (GroupV2)

Group public keys start with `03`. Only GroupV2 (`03`-prefix) is supported.

### `await client.createGroup(name, memberSessionIds): Promise<string>`
Create a new closed group. Returns the group public key (`03`-prefix).
Sends invites to all listed members. Pushes the new group config to linked devices.

```typescript
const groupId = await client.createGroup('My Group', ['05memberA...', '05memberB...']);
await client.sendMessage(groupId, 'Hello group!');
```

### `await client.addGroupMembers(groupId, sessionIds, options?): Promise<void>`
Add members to a group you admin. New members get no prior message history by default.

```typescript
await client.addGroupMembers(groupId, ['05newMember...']);
await client.addGroupMembers(groupId, ['05newMember...'], { withHistory: true }); // grant history access
```

### `await client.removeGroupMembers(groupId, sessionIds, options?): Promise<void>`
Remove members from a group you admin.

```typescript
await client.removeGroupMembers(groupId, ['05exMember...']);
await client.removeGroupMembers(groupId, ['05exMember...'], { alsoRemoveMessages: true });
```

### `await client.leaveGroup(groupId): Promise<void>`
Leave a group (or delete it locally if state is broken). Handles GroupV2 and legacy GroupV1.
Retries automatically if encryption keys are missing (broken group state).

---

## Attachments

### `await client.downloadAttachment(attachment, destDir?): Promise<string>`
Download and decrypt an attachment from the Session CDN.

- `attachment` must have `url`, `key`, and `digest` fields (present on received messages)
- If `destDir` is provided, writes the raw file to `<destDir>/<fileName>` and returns the full path
- If `destDir` is omitted, stores in the library's internal attachments directory and returns the relative path

```typescript
// Save to a specific directory
const localPath = await client.downloadAttachment(msg.attachments[0], '/tmp/downloads');

// Store in library's attachments dir
const internalPath = await client.downloadAttachment(msg.attachments[0]);
```

---

## Contacts

### `await client.acceptContactRequest(sessionId): Promise<void>`
Accept an incoming contact request. Sends a `MessageRequestResponse` to the requester
so their client shows the "accepted" state.

```typescript
const convos = await client.getConversations();
const requests = convos.filter(c => c.isIncomingRequest);
for (const c of requests) {
  await client.acceptContactRequest(c.id);
}
```

### `await client.blockContact(sessionId): Promise<void>`
Block a contact. Messages from them are no longer processed.

### `await client.unblockContact(sessionId): Promise<void>`
Unblock a previously blocked contact.

---

## Profile

### `await client.setDisplayName(name): Promise<void>`
Set the display name shown to other Session users.

---

## Events

`SessionClient` extends `EventEmitter`. You can listen for events directly:

```typescript
client.on('message:received', (msg: Message) => { ... });
client.on('conversation:updated', (convo: Conversation) => { ... });
client.on('ready', () => { ... });
client.on('shutdown', () => { ... });
```

Or use the async iterators (`client.messages()`, `client.conversations()`) for a cleaner API.

---

## Data Types

### `Message`
```typescript
{
  id: string;
  conversationId: string;
  source: string;            // sender's Session ID
  body?: string;
  timestamp: number;         // ms
  isOutgoing: boolean;
  attachments?: Attachment[];
  quote?: QuotedMessage;
  expireTimer?: number;      // seconds
  unread?: boolean;
  status?: 'sending' | 'sent' | 'read' | 'error';
}
```

### `Conversation`
```typescript
{
  id: string;                // Session ID or group pubkey
  type: string;              // 'private' | 'group' | 'publicChat'
  displayName?: string;
  avatarPath?: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageTimestamp?: number;
  members?: string[];        // group only
  expireTimer?: number;
  isApproved: boolean;       // false = we haven't accepted this contact yet
  isIncomingRequest: boolean; // true = pending contact request from them
}
```

### `Attachment`
```typescript
{
  contentType: string;       // MIME type
  fileName?: string;
  size?: number;             // bytes
  localPath?: string;        // set after download
  url?: string;              // CDN URL (set on received attachments)
  id?: string;
  key?: string;              // Base64 AES key (required for downloadAttachment)
  digest?: string;           // Base64 HMAC (required for downloadAttachment)
}
```

### `SendAttachmentOptions`
```typescript
{
  path: string;              // local file path
  contentType: string;       // MIME type
  fileName?: string;         // shown to recipient
}
```

---

## Integration Test Scripts

Located in `client/tests/`. Configure via `client/tests/.env`:

```env
MNEMONIC=word1 word2 ...      # account mnemonic
RECIPIENT_SESSION_ID=05abc... # target Session ID for send/group tests
GROUP_NAME=My Group           # name for group tests (default: "Claw - Test")
DATA_PATH=../../data          # relative to client/tests/ (default: /tmp/session-lib-test)
LOG_LEVEL=warn
```

| Script | Purpose |
|--------|---------|
| `node client/tests/smoke.js` | No-network: mnemonic, init, createAccount (14 assertions) |
| `node client/tests/send.js` | Send a DM and poll for delivery |
| `node client/tests/listen.js` | Listen for incoming DMs and echo them back |
| `node client/tests/group.js` | Create/reuse group, send message, poll for delivery |
| `node client/tests/group-listen.js` | Listen on existing group, echo messages back |
| `node client/tests/group-cleanup.js` | Delete all matching groups (or all `03`-prefix groups) |

---

## Important Notes

1. **One-time account setup**: The mnemonic derives the keypair stored in the local DB.
   Only needed on the first run. Subsequent runs call `initialize()` and the account loads automatically.

2. **Initialization is async**: All methods (except `getSessionId`, `isRegistered`) must be called
   after `await client.initialize()`.

3. **Shutdown is required**: Call `await client.shutdown()` before process exit to stop
   background polling and close the DB cleanly. Follow with `process.exit(0)` since worker
   threads keep the event loop alive.

4. **GroupV2 only**: `createGroup()`, `addGroupMembers()`, `removeGroupMembers()` only work
   with GroupV2 (`03`-prefix). Legacy GroupV1 (`05`-prefix groups) only supports `leaveGroup()`.

5. **Contact requests**: 1:1 messages from unknown contacts create a conversation where
   `isIncomingRequest: true`. Call `acceptContactRequest(sessionId)` before the conversation
   is fully usable.

6. **Attachment download requires crypto fields**: `downloadAttachment()` requires `url`, `key`,
   and `digest`. These are present on `Attachment` objects from incoming `Message` objects.
