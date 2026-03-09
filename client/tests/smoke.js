#!/usr/bin/env node
/**
 * Smoke test — verifies the library can initialize, create an account,
 * and shut down cleanly without connecting to the network.
 *
 * Usage:
 *   node client/tests/smoke.js
 *
 * No env vars required. Creates a temporary data directory that is
 * removed on exit.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

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

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

function rmdir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// --- test -------------------------------------------------------------------

async function run() {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'session-smoke-'));
  console.log(`\nSmoke test — data dir: ${dataPath}\n`);

  let client;
  try {
    const { SessionClient } = require('../../dist-lib/client/index.js');

    // ---- generateMnemonic --------------------------------------------------
    console.log('1. generateMnemonic()');
    const mnemonic = await SessionClient.generateMnemonic();
    assert(typeof mnemonic === 'string', 'returns a string');
    assert(mnemonic.split(' ').length >= 13, `has >=13 words (got ${mnemonic.split(' ').length})`);
    console.log(`   mnemonic: ${mnemonic}\n`);

    // ---- initialize --------------------------------------------------------
    console.log('2. initialize()');
    client = new SessionClient({ dataPath, logLevel: 'warn' });
    await client.initialize();
    assert(true, 'initialize() resolved without throwing');
    assertEqual(client.isRegistered(), false, 'isRegistered() is false before createAccount()');
    assertEqual(client.getSessionId(), null, 'getSessionId() is null before createAccount()');
    console.log();

    // ---- createAccount -----------------------------------------------------
    console.log('3. createAccount()');
    const sessionId = await client.createAccount(mnemonic, 'Test Bot');
    assert(typeof sessionId === 'string', 'returns a string');
    assert(sessionId.startsWith('05'), `session ID starts with 05 (got: ${sessionId.slice(0, 4)}...)`);
    assertEqual(sessionId.length, 66, `session ID is 66 chars (got ${sessionId.length})`);
    assertEqual(client.isRegistered(), true, 'isRegistered() is true after createAccount()');
    assertEqual(client.getSessionId(), sessionId, 'getSessionId() matches returned ID');
    console.log(`   session ID: ${sessionId}\n`);

    /* I commented this out because i'm not sure I want it in there.
    // ---- getRecoveryMnemonic -----------------------------------------------
    console.log('4. getRecoveryMnemonic()');
    const recovered = await client.getRecoveryMnemonic();
    assert(recovered !== null, 'returns non-null');
    assertEqual(recovered, mnemonic, 'matches the original mnemonic');
    console.log();
    */

    // ---- getConversations --------------------------------------------------
    console.log('5. getConversations()');
    const convos = await client.getConversations();
    assert(Array.isArray(convos), 'returns an array');
    console.log(`   ${convos.length} conversation(s) loaded`);
    console.log();

  } finally {
    if (client) {
      console.log('6. shutdown()');
      await client.shutdown();
      assert(true, 'shutdown() resolved without throwing');
      console.log();
    }
    rmdir(dataPath);
  }

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
