#!/usr/bin/env node
/**
 * Integration test — restores an account and listens for incoming messages.
 * Exits after TIMEOUT_MS with a summary of what was received.
 *
 * Required env vars (or set in .env):
 *   MNEMONIC               — 13-word mnemonic for the listening account
 *
 * Optional:
 *   DATA_PATH              — where to store DB / keys (default: /tmp/session-lib-test)
 *   TIMEOUT_MS             — how long to wait for messages in ms (default: 30000)
 *   LOG_LEVEL              — pino log level (default: info)
 *
 * Usage:
 *   MNEMONIC="word1 word2 ..." node client/tests/listen.js
 *
 * Send a message to this account's Session ID from another client within
 * the timeout window to verify the full receive path.
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

const MNEMONIC = process.env.MNEMONIC;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(__dirname, process.env.DATA_PATH)
  : path.join(os.tmpdir(), 'session-lib-test');
const DOWNLOADS_PATH = process.env.DOWNLOADS_PATH
  ? path.resolve(__dirname, process.env.DOWNLOADS_PATH)
  : path.join(DATA_PATH, 'downloads');
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '30000', 10);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!MNEMONIC) {
  console.error('\nERROR: MNEMONIC is required. Set it in the environment or in client/tests/.env\n');
  process.exit(1);
}

// --- test -------------------------------------------------------------------

async function run() {
  console.log(`\nListen test`);
  console.log(`  data path  : ${DATA_PATH}`);
  console.log(`  downloads  : ${DOWNLOADS_PATH}`);
  console.log(`  timeout    : ${TIMEOUT_MS}ms\n`);

  fs.mkdirSync(DATA_PATH, { recursive: true });

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
  console.log(`\nListening as: ${sessionId}`);
  console.log(`Send a message to this Session ID within ${TIMEOUT_MS / 1000}s...\n`);

  // ---- listen for messages with timeout ------------------------------------
  const received = [];
  const seenIds = new Set();

  const timeoutPromise = new Promise(resolve => setTimeout(resolve, TIMEOUT_MS));

  const listenPromise = (async () => {
    for await (const msg of client.messages()) {
      received.push(msg);
      console.log(`\n📨 Received message:`);
      console.log(`   from    : ${msg.source}`);
      console.log(`   body    : ${msg.body ?? '(no body)'}`);
      console.log(`   time    : ${new Date(msg.timestamp).toISOString()}`);

      if (msg.source && !seenIds.has(msg.id)) {
        seenIds.add(msg.id);
        try {
          await client.setTyping(msg.source, true);
        } catch (e) {
          console.log(`   ↳ typing indicator (start) failed: ${e.message}`);
        }

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

        let replyBody = `Got it: ${msg.body ?? ''}`;
        if (hasNonImageAttachment) replyBody += ' (attachment file received)';
        const replyOpts = {
          quote: { id: msg.id, author: msg.source, text: msg.body ?? '' },
          ...(downloadedImages.length > 0 ? { attachments: downloadedImages } : {}),
        };
        try {
          await client.sendMessage(msg.source, replyBody, replyOpts);
          console.log(`   → replied to ${msg.source}${downloadedImages.length > 0 ? ` with ${downloadedImages.length} image(s)` : ''}`);
        } finally {
          try {
            await client.setTyping(msg.source, false);
          } catch (e) {
            console.log(`   ↳ typing indicator (stop) failed: ${e.message}`);
          }
        }
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
    console.log(`\n✅  Received ${received.length} message(s) in ${TIMEOUT_MS / 1000}s.\n`);
    process.exit(0);
  } else {
    console.log(`\n⏱  No messages received within ${TIMEOUT_MS / 1000}s.\n`);
    // exit 0 — timeout isn't a failure, just nothing was sent
    process.exit(0);
  }
}

run().catch(err => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
