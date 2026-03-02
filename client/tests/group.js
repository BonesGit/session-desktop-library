#!/usr/bin/env node
/**
 * Integration test — creates (or reuses) a group and sends a test message to it.
 *
 * Required env vars (or set in .env):
 *   MNEMONIC               — 13-word mnemonic for the account that creates / manages the group
 *   RECIPIENT_SESSION_ID   — Session ID of the member to invite
 *
 * Optional:
 *   DATA_PATH              — where to store DB / keys (default: /tmp/session-lib-test)
 *   GROUP_MESSAGE          — message to send (default: "Hello from session-lib group test")
 *   SYNC_WAIT_MS           — ms to wait for config sync after account restore (default: 15000)
 *   SEND_WAIT_MS           — ms to poll for 'sent' status (default: 20000)
 *   LOG_LEVEL              — pino log level (default: warn)
 *
 * The group name is always "Claw - Test". If a group with that name already
 * exists in the account's conversations it will be reused; a new one is only
 * created when none is found.
 *
 * Usage:
 *   MNEMONIC="word1 word2 ..." \
 *   RECIPIENT_SESSION_ID="05abc..." \
 *   node client/tests/group.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Load .env if it exists next to this file
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^[\"']|[\"']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

// --- helpers ----------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function die(message) {
  console.error(`\nERROR: ${message}\n`);
  process.exit(1);
}

// --- validate env -----------------------------------------------------------

const GROUP_NAME = process.env.GROUP_NAME || 'Claw - Test';
const MNEMONIC = process.env.MNEMONIC;
const RECIPIENT_SESSION_ID = process.env.RECIPIENT_SESSION_ID;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(__dirname, process.env.DATA_PATH)
  : path.join(os.tmpdir(), 'session-lib-test');
const GROUP_MESSAGE = process.env.GROUP_MESSAGE || `Hello from session-lib group test @ ${new Date().toISOString()}`;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!MNEMONIC) {
  die('MNEMONIC is required. Set it in the environment or in client/tests/.env');
}
if (!RECIPIENT_SESSION_ID) {
  die('RECIPIENT_SESSION_ID is required. Set it in the environment or in client/tests/.env');
}
if (!RECIPIENT_SESSION_ID.startsWith('05') || RECIPIENT_SESSION_ID.length !== 66) {
  die(`RECIPIENT_SESSION_ID looks invalid: "${RECIPIENT_SESSION_ID}"\nExpected a 66-char hex string starting with "05".`);
}

// --- test -------------------------------------------------------------------

async function run() {
  console.log(`\nGroup test`);
  console.log(`  data path  : ${DATA_PATH}`);
  console.log(`  group name : ${GROUP_NAME}`);
  console.log(`  recipient  : ${RECIPIENT_SESSION_ID}`);
  console.log(`  message    : "${GROUP_MESSAGE}"\n`);

  fs.mkdirSync(DATA_PATH, { recursive: true });

  const { SessionClient } = require('../../dist-lib/client/index.js');

  // ---- initialize ----------------------------------------------------------
  console.log('1. initialize()');
  const client = new SessionClient({ dataPath: DATA_PATH, logLevel: LOG_LEVEL });
  await client.initialize();
  assert(true, 'initialize() resolved');

  // ---- restore or use existing account ------------------------------------
  let sessionId = client.getSessionId();

  if (!sessionId) {
    console.log('\n2. restoreAccount()  (no existing account found)');
    sessionId = await client.restoreAccount(MNEMONIC);
    assert(typeof sessionId === 'string' && sessionId.startsWith('05'), `restored session ID: ${sessionId}`);
  } else {
    console.log('\n2. (existing account found — skipping restore)');
    assert(true, `using existing session ID: ${sessionId}`);
  }
  console.log();

  // ---- wait for config sync + onion paths ---------------------------------
  const SYNC_WAIT = parseInt(process.env.SYNC_WAIT_MS || '15000', 10);
  console.log(`3. waiting ${SYNC_WAIT / 1000}s for config sync + onion paths...`);
  await new Promise(r => setTimeout(r, SYNC_WAIT));
  assert(true, `waited ${SYNC_WAIT / 1000}s`);
  console.log();

  // ---- find or create group ------------------------------------------------
  console.log(`4. find or create group "${GROUP_NAME}"`);
  const convos = await client.getConversations();
  console.log('Conversations:', convos.map(c => ({ id: c.id, displayName: c.displayName })));
  const matchingGroups = convos.filter(c =>
    c.id.startsWith('03') && c.displayName === GROUP_NAME
  );

  // Leave any duplicate groups — keep the first (oldest) one
  if (matchingGroups.length > 1) {
    const duplicates = matchingGroups.slice(1);
    console.log(`   → found ${matchingGroups.length} groups named "${GROUP_NAME}" — leaving ${duplicates.length} duplicate(s):`);
    for (const dup of duplicates) {
      console.log(`     leaving ${dup.id}`);
      await client.leaveGroup(dup.id);
    }
  }

  let group = matchingGroups[0] || null;

  if (group) {
    console.log(`   → reusing existing group`);
    assert(true, `reusing existing group "${GROUP_NAME}"`);
  } else {
    console.log(`   → no existing group found — creating...`);
    const groupId = await client.createGroup(GROUP_NAME, [RECIPIENT_SESSION_ID]);
    assert(typeof groupId === 'string' && groupId.startsWith('03'), `createGroup() returned a valid ID`);
    group = { id: groupId };

    // Wait for the group invite job to finish sending 1:1 to the recipient's swarm
    const INVITE_WAIT = parseInt(process.env.INVITE_WAIT_MS || '8000', 10);
    console.log(`   → waiting ${INVITE_WAIT / 1000}s for invite to be delivered...`);
    await new Promise(r => setTimeout(r, INVITE_WAIT));
  }
  console.log(`  group ID   : ${group.id}\n`);

  const groupId = group.id;

  // ---- send message --------------------------------------------------------
  console.log('5. sendMessage() to group');
  const msgId = await client.sendMessage(groupId, GROUP_MESSAGE);
  assert(typeof msgId === 'string', `sendMessage() returned an ID: ${msgId}`);
  console.log();

  // ---- poll for delivery ---------------------------------------------------
  console.log('6. waiting for network delivery...');
  const SEND_WAIT = parseInt(process.env.SEND_WAIT_MS || '20000', 10);
  const deadline = Date.now() + SEND_WAIT;
  let deliveredMsg = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await client.getMessages(groupId, { limit: 20 });
    deliveredMsg = check.find(m => m.isOutgoing && m.body === GROUP_MESSAGE);
    if (deliveredMsg && deliveredMsg.status === 'sent') {
      break;
    }
  }
  console.log(`  message status: ${deliveredMsg?.status ?? 'not found'}`);
  assert(deliveredMsg !== undefined, 'outgoing message found in history');
  assert(deliveredMsg?.status === 'sent', `message status is 'sent' (was: ${deliveredMsg?.status})`);
  console.log();

  // ---- verify in history ---------------------------------------------------
  console.log('7. getMessages()');
  const msgs = await client.getMessages(groupId, { limit: 10 });
  assert(Array.isArray(msgs), 'getMessages() returns an array');
  const sent = msgs.find(m => m.isOutgoing && m.body === GROUP_MESSAGE);
  assert(sent !== undefined, 'sent message appears in conversation history');
  console.log();

  // ---- shutdown ------------------------------------------------------------
  console.log('8. shutdown()');
  await client.shutdown();
  assert(true, 'shutdown() resolved');
  console.log();

  // ---- summary -------------------------------------------------------------
  console.log('─'.repeat(40));
  if (failed === 0) {
    console.log(`\n✅  All ${passed} assertions passed.\n`);
    process.exit(0);
  } else {
    console.log(`\n❌  ${failed} assertion(s) failed, ${passed} passed.\n`);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
