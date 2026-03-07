/**
 * Types shared between the UI composition layer (ts/components/) and the backend model layer
 * (ts/models/). Extracted here so ts/models/ can import these types without pulling in
 * React component dependencies.
 *
 * ts/components/ files may continue importing these types directly from this file or from
 * their original locations (the component files re-export for backward compat).
 */

import type * as MIME from './MIME';
import type { AttachmentType } from './Attachment';

// Inlined from ts/components/conversation/composition/CompositionBox.tsx
export interface ReplyingToMessageProps {
  convoId: string;
  id: string;
  author: string;
  timestamp: number;
  text?: string;
  attachments?: Array<any>;
}

// Inlined from ts/util/attachment/attachmentsUtil.ts
export type StagedAttachmentImportedType = Omit<AttachmentType, 'url' | 'fileSize'> & {
  path?: string;
  flags?: number;
};

export type StagedImagePreviewImportedType = Pick<
  AttachmentType,
  'contentType' | 'size' | 'width' | 'height'
> & { path?: string };

export type StagedPreviewImportedType = {
  url: string;
  title: string;
  image?: StagedImagePreviewImportedType;
};

// Inlined from ts/components/conversation/composition/CompositionBox.tsx
export type SendMessageType = {
  conversationId: string;
  body: string;
  attachments: Array<StagedAttachmentImportedType> | undefined;
  preview: Array<StagedPreviewImportedType> | undefined;
  groupInvitation: { url: string | undefined; name: string } | undefined;
  quote?: any;
};

// Inlined from ts/components/conversation/message/message-content/quote/Quote.tsx
export interface QuotedAttachmentThumbnailType {
  contentType: MIME.MIMEType;
  objectUrl?: string;
}

export interface QuotedAttachmentType {
  contentType: MIME.MIMEType;
  fileName: string;
  isVoiceMessage: boolean;
  thumbnail?: QuotedAttachmentThumbnailType;
}
