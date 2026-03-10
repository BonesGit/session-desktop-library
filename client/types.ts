import type { Logger } from 'pino';
import type { SessionBooleanFeatureFlags } from '../ts/state/ducks/types/releasedFeaturesReduxTypes';

// ---- Config ----------------------------------------------------------------

export interface SessionClientConfig {
  /** Directory where the database, attachments, and keys are stored. */
  dataPath: string;
  /** SQLCipher encryption password. Leave empty for an unencrypted DB. */
  password?: string;
  /** Custom pino logger. Defaults to stdout at 'info' level. */
  logger?: Logger;
  /** Log level when no custom logger is provided. */
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  /** Override bootstrap seed node URLs. */
  seedNodes?: Array<string>;
  /** Override default Session boolean feature flags. */
  featureFlags?: Partial<SessionBooleanFeatureFlags>;
}

// ---- Public data types -----------------------------------------------------

export interface Attachment {
  /** Content-type (MIME type), e.g. 'image/jpeg' */
  contentType: string;
  /** Original file name */
  fileName?: string;
  /** File size in bytes */
  size?: number;
  /** Local filesystem path — populated after download */
  localPath?: string;
  /** Remote CDN URL */
  url?: string;
  /** Attachment ID (part of the CDN URL) */
  id?: string;
  /** Base64-encoded AES key for decryption (required for downloadAttachment) */
  key?: string;
  /** Base64-encoded HMAC digest for integrity check (required for downloadAttachment) */
  digest?: string;
}

export interface QuotedMessage {
  /** Timestamp of the quoted message */
  id: number;
  /** Session ID of the quoted message's author */
  author: string;
  /** Preview text of the quoted message */
  text?: string;
}

export interface Message {
  /** Sent-at network timestamp as string — use as quote.id */
  id: string;
  /** Raw database UUID — use this as the messageDbId argument to sendReaction() */
  dbId: string;
  /** Conversation this message belongs to */
  conversationId: string;
  /** Session ID of the sender */
  source: string;
  /** Message body text */
  body?: string;
  /** Sent-at timestamp (ms) */
  timestamp: number;
  /** Whether this message was sent by us */
  isOutgoing: boolean;
  /** Attached files */
  attachments?: Array<Attachment>;
  /** Quoted message, if any */
  quote?: QuotedMessage;
  /** Disappearing message timer in seconds */
  expireTimer?: number;
  /** Whether the message has been read */
  unread?: boolean;
  /**
   * Delivery status for outgoing messages:
   * - 'sending' — queued, not yet delivered to the network
   * - 'sent'    — successfully delivered to the recipient's swarm
   * - 'read'    — recipient has read the message (requires read receipts)
   * - 'error'   — delivery failed
   */
  status?: 'sending' | 'sent' | 'read' | 'error';
}

export interface Conversation {
  /** Session ID (1:1) or group public key */
  id: string;
  /** 'private' | 'group' | 'publicChat' */
  type: string;
  /** Display name */
  displayName?: string;
  /** Local path to avatar image */
  avatarPath?: string;
  /** Unread message count */
  unreadCount: number;
  /** Preview of last message */
  lastMessage?: string;
  /** Timestamp of last message (ms) */
  lastMessageTimestamp?: number;
  /** Members (group conversations only) */
  members?: Array<string>;
  /** Whether messages expire */
  expireTimer?: number;
  /** Whether we have approved this contact (false = we haven't accepted yet) */
  isApproved: boolean;
  /** Whether this is an incoming contact request we haven't responded to */
  isIncomingRequest: boolean;
}

// ---- Send options ----------------------------------------------------------

export interface SendAttachmentOptions {
  /** Local file path to send */
  path: string;
  /** MIME type */
  contentType: string;
  /** Optional file name shown to recipient */
  fileName?: string;
}

export interface SendMessageOptions {
  attachments?: Array<SendAttachmentOptions>;
  quote?: QuotedMessage;
  /** Disappearing messages timer in seconds (0 = off) */
  expireTimer?: number;
}
