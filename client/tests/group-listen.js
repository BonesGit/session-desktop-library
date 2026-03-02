#!/usr/bin/env node
/**
 * Integration test — finds the GROUP_NAME group, then listens for incoming
 * messages on it and replies to each one back to the group.
 *
 * The group must already exist (created via group.js). If no matching group
 * is found the test logs an error and exits with a non-zero status.
 *
 * Required env vars (or set in .env):
 *   MNEMONIC               — 13-word mnemonic for the account that owns the group
 *   GROUP_NAME             — name of the group to listen on (default: "Claw - Test")
 *
 * Optional:
 *   DATA_PATH              — where to store DB / keys (default: /tmp/session-lib-test)
 *   DOWNLOADS_PATH         — where to save received attachments (default: DATA_PATH/downloads)
 *   SYNC_WAIT_MS           — ms to wait for config sync + onion paths (default: 15000)
 *   TIMEOUT_MS             — how long to listen for messages in ms (default: 60000)
 *   LOG_LEVEL              — pino log level (default: info)
 *
 * Usage:
 *   node client/tests/group-listen.js
 *
 * Send a message to the group from the Session app within the timeout window
 * and the library will echo it back to the group.
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
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

// --- validate env -----------------------------------------------------------

const GROUP_NAME = process.env.GROUP_NAME || 'Claw - Test';
const MNEMONIC = process.env.MNEMONIC;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(__dirname, process.env.DATA_PATH)
  : path.join(os.tmpdir(), 'session-lib-test');
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH
  ? path.resolve(__dirname, process.env.DOWNLOADS_PATH)
  : path.join(DATA_PATH, 'downloads');
const SYNC_WAIT = parseInt(process.env.SYNC_WAIT_MS || '15000', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '60000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

function die(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

if (!MNEMONIC) die('MNEMONIC is required. Set it in the environment or in client/tests/.env');

// --- test -------------------------------------------------------------------

async function run() {
  console.log(`\nGroup listen test`);
  console.log(`  group name : ${GROUP_NAME}`);
  console.log(`  data path  : ${DATA_PATH}`);
  console.log(`  downloads  : ${DOWNLOADS_PATH}`);
  console.log(`  sync wait  : ${SYNC_WAIT / 1000}s`);
  console.log(`  timeout    : ${TIMEOUT_MS / 1000}s\n`);

  fs.mkdirSync(DATA_PATH, { recursive: true });
  fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });

  const { SessionClient } = require('../../dist-lib/client/index.js');

  // ---- initialize ----------------------------------------------------------
  console.log('Initializing...');
  const client = new SessionClient({ dataPath: DATA_PATH, logLevel: LOG_LEVEL });
  await client.initialize();

  // ---- restore or use existing account ------------------------------------
  let sessionId = client.getSessionId();
  if (!sessionId) {
    console.log('Restoring account...');
    sessionId = await client.restoreAccount(MNEMONIC);
  }
  console.log(`Listening as: ${sessionId}\n`);

  // ---- wait for config sync + onion paths ---------------------------------
  console.log(`Waiting ${SYNC_WAIT / 1000}s for config sync + onion paths...`);
  await new Promise(r => setTimeout(r, SYNC_WAIT));

  // ---- find group (must already exist) -------------------------------------
  console.log(`Looking for group "${GROUP_NAME}"...`);
  const convos = await client.getConversations();
  const matchingGroups = convos.filter(c =>
    c.id.startsWith('03') && c.displayName === GROUP_NAME
  );

  if (matchingGroups.length === 0) {
    console.error(`\n❌  Group "${GROUP_NAME}" not found. Run group.js first to create it.\n`);
    await client.shutdown();
    process.exit(1);
  }

  // Leave any duplicate groups — keep the first (oldest) one
  if (matchingGroups.length > 1) {
    const duplicates = matchingGroups.slice(1);
    console.log(`   → found ${matchingGroups.length} groups named "${GROUP_NAME}" — leaving ${duplicates.length} duplicate(s):`);
    for (const dup of duplicates) {
      console.log(`     leaving ${dup.id}`);
      await client.leaveGroup(dup.id);
    }
  }

  const groupId = matchingGroups[0].id;
  console.log(`  → found group: ${groupId}`);

  console.log(`\nSend a message to "${GROUP_NAME}" within ${TIMEOUT_MS / 1000}s...\n`);

  // ---- listen for group messages with timeout ------------------------------
  const received = [];
  const seenIds = new Set();

  const timeoutPromise = new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));

  const listenPromise = (async () => {
    for await (const msg of client.messages()) {
      // Only handle incoming messages belonging to this group
      if (msg.conversationId !== groupId) continue;
      if (msg.isOutgoing) continue;

      received.push(msg);
      console.log(`\n📨 Received group message:`);
      console.log(`   from    : ${msg.source}`);
      console.log(`   body    : ${msg.body ?? '(no body)'}`);
      console.log(`   time    : ${new Date(msg.timestamp).toISOString()}`);

      // Download attachments and track images to echo back
      const downloadedImages = [];
      let hasNonImageAttachment = false;
      if (msg.attachments?.length) {
        console.log(`   attach  : ${msg.attachments.length} attachment(s)`);
        for (const att of msg.attachments) {
          try {
            const localPath = await client.downloadAttachment(att, DOWNLOADS_PATH);
            console.log(`   ↳ downloaded: ${att.fileName ?? att.contentType} → ${localPath}`);
            if (att.contentType?.startsWith('image/')) {
              downloadedImages.push({ path: localPath, contentType: att.contentType, fileName: att.fileName });
            } else {
              hasNonImageAttachment = true;
            }
          } catch (e) {
            console.log(`   ↳ download failed: ${e.message}`);
          }
        }
      }

      // Reply back to the group (deduplicated by message ID)
      if (!seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        let replyBody = `Got it: ${msg.body ?? ''}`;
        if (hasNonImageAttachment) replyBody += ' (attachment file received)';
        const replyOpts = downloadedImages.length > 0 ? { attachments: downloadedImages } : {};
        await client.sendMessage(groupId, replyBody, replyOpts);
        console.log(`   → replied to group${downloadedImages.length > 0 ? ` with ${downloadedImages.length} image(s)` : ''}`);
      }
    }
  })();

  // race: either we hit the timeout or the listen loop ends
  await Promise.race([timeoutPromise, listenPromise]);

  // ---- shutdown ------------------------------------------------------------
  console.log('\nShutting down...');
  await client.shutdown();

  // ---- summary -------------------------------------------------------------
  console.log('\n' + '─'.repeat(40));
  if (received.length > 0) {
    console.log(`\n✅  Received ${received.length} group message(s) in ${TIMEOUT_MS / 1000}s.\n`);
    process.exit(0);
  } else {
    console.log(`\n⏱  No group messages received within ${TIMEOUT_MS / 1000}s.\n`);
    // exit 0 — timeout isn't a failure, just nothing was sent
    process.exit(0);
  }
}

run().catch(err => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
