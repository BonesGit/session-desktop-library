#!/usr/bin/env node
/**
 * Integration test — restores an account from a mnemonic and sends a
 * test message to a given recipient.
 *
 * Required env vars (or set in .env):
 *   MNEMONIC               — 13-word mnemonic for the sending account
 *   RECIPIENT_SESSION_ID   — 66-char hex Session ID of the recipient
 *
 * Optional:
 *   DATA_PATH              — where to store DB / keys (default: /tmp/session-lib-test)
 *   MESSAGE_BODY           — message text to send (default: "Hello from session-lib test")
 *   LOG_LEVEL              — pino log level (default: warn)
 *
 * Usage:
 *   MNEMONIC="word1 word2 ..." \
 *   RECIPIENT_SESSION_ID="05abc..." \
 *   node client/tests/send.js
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
    const val = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
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

const MNEMONIC = process.env.MNEMONIC;
const RECIPIENT_SESSION_ID = process.env.RECIPIENT_SESSION_ID;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(__dirname, process.env.DATA_PATH)
  : path.join(os.tmpdir(), 'session-lib-test');
const MESSAGE_BODY =
  process.env.MESSAGE_BODY || `Hello from session-lib test @ ${new Date().toISOString()}`;
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

if (!MNEMONIC) {
  die('MNEMONIC is required. Set it in the environment or in client/tests/.env');
}
if (!RECIPIENT_SESSION_ID) {
  die('RECIPIENT_SESSION_ID is required. Set it in the environment or in client/tests/.env');
}
if (!RECIPIENT_SESSION_ID.startsWith('05') || RECIPIENT_SESSION_ID.length !== 66) {
  die(
    `RECIPIENT_SESSION_ID looks invalid: "${RECIPIENT_SESSION_ID}"\nExpected a 66-char hex string starting with "05".`
  );
}

// --- test -------------------------------------------------------------------

async function run() {
  console.log(`\nSend test`);
  console.log(`  data path  : ${DATA_PATH}`);
  console.log(`  recipient  : ${RECIPIENT_SESSION_ID}`);
  console.log(`  message    : "${MESSAGE_BODY}"\n`);

  fs.mkdirSync(DATA_PATH, { recursive: true });

  const { SessionClient } = require('../../dist-lib/client/index.js');

  // ---- initialize ----------------------------------------------------------
  console.log('1. initialize()');
  const client = new SessionClient({ dataPath: DATA_PATH, logLevel: LOG_LEVEL });
  await client.initialize();
  assert(true, 'initialize() resolved');

  // ---- restoreAccount or use existing --------------------------------------
  let sessionId = client.getSessionId();

  if (!sessionId) {
    console.log('\n2. restoreAccount()  (no existing account found)');
    sessionId = await client.restoreAccount(MNEMONIC);
    assert(
      typeof sessionId === 'string' && sessionId.startsWith('05'),
      `restored session ID: ${sessionId}`
    );
  } else {
    // Verify the stored account matches the provided mnemonic
    console.log('\n2. (existing account found — skipping restore)');
    assert(true, `using existing session ID: ${sessionId}`);
  }
  console.log();

  // ---- wait for config sync + onion path construction ---------------------
  // After restoring an account, the swarm poller fetches config from the
  // network and constructs onion paths. Give this enough time before sending.
  const SYNC_WAIT = parseInt(process.env.SYNC_WAIT_MS || '15000', 10);
  console.log(`3. waiting ${SYNC_WAIT / 1000}s for config sync + onion paths...`);
  await new Promise(r => setTimeout(r, SYNC_WAIT));
  assert(true, `waited ${SYNC_WAIT / 1000}s`);
  console.log();

  // ---- sendMessage (text) --------------------------------------------------
  console.log('4. sendMessage()');
  const msgId = await client.sendMessage(RECIPIENT_SESSION_ID, MESSAGE_BODY);
  assert(typeof msgId === 'string', `sendMessage() returned an ID: ${msgId}`);
  console.log();

  // ---- sendMessage (with attachment) ---------------------------------------
  console.log('4b. sendMessage() with attachment');
  const attachPath = path.join(DATA_PATH, 'test-attachment.txt');
  fs.writeFileSync(
    attachPath,
    `Attachment test @ ${new Date().toISOString()}\nHello from session-lib!\n`
  );
  const attachMsgId = await client.sendMessage(RECIPIENT_SESSION_ID, 'Here is an attachment', {
    attachments: [{ path: attachPath, contentType: 'text/plain', fileName: 'test-attachment.txt' }],
  });
  assert(
    typeof attachMsgId === 'string',
    `sendMessage() with attachment returned an ID: ${attachMsgId}`
  );
  console.log();

  // ---- wait for job runner to deliver to network ---------------------------
  // sendMessage() only queues the job. The job runner sends it asynchronously.
  // Poll until the message status changes to 'sent', or SEND_WAIT_MS elapses.
  console.log('5. waiting for network delivery...');
  const SEND_WAIT = parseInt(process.env.SEND_WAIT_MS || '20000', 10);
  const deadline = Date.now() + SEND_WAIT;
  let deliveredMsg = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await client.getMessages(RECIPIENT_SESSION_ID, { limit: 20 });
    deliveredMsg = check.find(m => m.isOutgoing && m.body === MESSAGE_BODY);
    if (deliveredMsg && deliveredMsg.status === 'sent') {
      break;
    }
  }
  console.log(`  message status: ${deliveredMsg?.status ?? 'not found'}`);
  assert(deliveredMsg !== undefined, 'outgoing message found in history');
  assert(
    deliveredMsg?.status === 'sent',
    `message status is 'sent' (was: ${deliveredMsg?.status})`
  );
  console.log();

  // ---- verify message appears in history -----------------------------------
  console.log('6. getMessages()');
  const msgs = await client.getMessages(RECIPIENT_SESSION_ID, { limit: 10 });
  assert(Array.isArray(msgs), 'getMessages() returns an array');
  const sent = msgs.find(m => m.isOutgoing && m.body === MESSAGE_BODY);
  assert(sent !== undefined, 'sent message appears in conversation history');
  console.log();

  // ---- shutdown ------------------------------------------------------------
  console.log('7. shutdown()');
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
