#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Load .env
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

const MNEMONIC = process.env.MNEMONIC;
const DATA_PATH = process.env.DATA_PATH
  ? path.resolve(__dirname, process.env.DATA_PATH)
  : path.join(os.tmpdir(), 'session-lib-test');
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
// Optional: only delete groups matching this name (e.g. GROUP_NAME="Claw - Test")
const GROUP_NAME = process.env.GROUP_NAME || null;

if (!MNEMONIC) {
  console.error('MNEMONIC is required');
  process.exit(1);
}

async function run() {
  const { SessionClient } = require('../../dist-lib/client/index.js');
  const client = new SessionClient({ dataPath: DATA_PATH, logLevel: LOG_LEVEL });
  await client.initialize();

  let sessionId = client.getSessionId();
  if (!sessionId) {
    sessionId = await client.restoreAccount(MNEMONIC);
  }
  console.log(`\nGroup cleanup`);
  console.log(`  account   : ${sessionId}`);
  console.log(`  data path : ${DATA_PATH}`);
  if (GROUP_NAME) console.log(`  filter    : "${GROUP_NAME}"`);
  console.log();

  const convos = await client.getConversations();
  const groups = convos.filter(c => {
    if (!c.id.startsWith('03')) return false;
    if (GROUP_NAME && c.displayName !== GROUP_NAME) return false;
    return true;
  });

  if (groups.length === 0) {
    console.log('  No matching groups found.\n');
    await client.shutdown();
    process.exit(0);
  }

  console.log(`  Found ${groups.length} group(s) to delete:\n`);
  for (const g of groups) {
    console.log(`  → ${g.id}  "${g.displayName ?? '(no name)'}"`);
  }
  console.log();

  for (const g of groups) {
    try {
      await client.leaveGroup(g.id);
      console.log(`  ✓ deleted ${g.id.slice(0, 20)}...  "${g.displayName ?? ''}"`);
    } catch (e) {
      console.log(`  ✗ failed  ${g.id.slice(0, 20)}...  "${g.displayName ?? ''}": ${e.message}`);
    }
  }

  console.log('\nShutting down...');
  await client.shutdown();
  console.log('Done.\n');
  process.exit(0);
}

run().catch(err => {
  console.error('\nUnhandled error:', err);
  process.exit(1);
});
