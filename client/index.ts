/**
 * session-desktop-library
 *
 * Headless Node.js API for the Session decentralized messaging protocol.
 *
 * @example
 * import { SessionClient } from 'session-desktop-library';
 *
 * const client = new SessionClient({ dataPath: '/path/to/data' });
 * await client.initialize();
 *
 * const mnemonic = await SessionClient.generateMnemonic();
 * const sessionId = await client.createAccount(mnemonic, 'Alice');
 * console.log('My Session ID:', sessionId);
 *
 * await client.sendMessage('05...', 'Hello from the library!');
 *
 * for await (const msg of client.messages()) {
 *   console.log('Received:', msg.body);
 * }
 */

// Install a minimal global.window stub immediately on require().
// Many backend modules call window?.log?.* at module load time (e.g. JobRunner
// singletons created at file scope). Node.js has no `window` variable at all —
// even optional chaining `window?.log` throws ReferenceError if `window` is
// undeclared. This stub satisfies those calls safely. SessionClient.initialize()
// will replace it with the full configured shim once the user's config is known.
if (typeof window === 'undefined') {
  const noop = () => {};
  (global as NodeJS.Global & { window: unknown }).window = {
    log: { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop },
    // focusListener.js calls window.addEventListener at module load time
    addEventListener: noop,
    removeEventListener: noop,
  };
}

export { SessionClient } from './SessionClient';

export type {
  SessionClientConfig,
  Message,
  Conversation,
  Attachment,
  QuotedMessage,
  SendMessageOptions,
  SendAttachmentOptions,
} from './types';
