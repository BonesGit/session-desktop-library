/**
 * UI-only type definitions that reference React types.
 * This file is excluded from the library build (tsconfig.lib.json).
 * Component files should import RenderTextCallbackType from here.
 */
import type { JSX } from 'react';

export type RenderTextCallbackType = (options: {
  text: string;
  key: number;
  isGroup: boolean;
  isPublic: boolean;
}) => JSX.Element;
