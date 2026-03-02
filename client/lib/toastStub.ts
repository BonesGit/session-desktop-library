/**
 * No-op stub for ToastUtils (ts/session/utils/Toast.tsx).
 *
 * Toast.tsx imports react-toastify (a DOM/browser library) and React.
 * In the Node.js library build, toast notifications are meaningless — we
 * redirect them to the logger instead.
 *
 * This file is used via tsconfig.lib.json `paths` aliasing OR by simply
 * ensuring the library initializer sets up the global shim before
 * toast functions are called (which makes them fall through to window.log).
 *
 * Since backend code calls e.g. ToastUtils.pushToastError(...), and the
 * global shim provides window.log, we just define no-op stubs here as a
 * safety net for any direct imports.
 */

const noop = (..._args: Array<unknown>): void => {
  // In library mode, toasts are silently dropped.
  // window.log calls from caller sites already handle logging.
};

export const pushToastError = noop;
export const pushToastWarning = noop;
export const pushToastInfo = noop;
export const pushToastSuccess = noop;
export const pushToastDanger = noop;
export const pushUnblockToSend = noop;
export const pushYouDoNotHaveThisFeature = noop;
export const pushMessageDeleteForbidden = noop;
export const pushCannotMixAttachmentTypes = noop;
export const pushMaximumAttachmentsError = noop;
export const pushFileSizeErrorAsByte = noop;
export const pushFileSizeError = noop;
export const pushMultipleNonImageError = noop;
export const pushAudioPermissionNeeded = noop;
export const pushVideoPermissionNeeded = noop;
export const pushNoCameraPermission = noop;
export const pushMicroPermissionNeeded = noop;
export const pushCallAlreadyExists = noop;

export const ToastUtils = {
  pushToastError: noop,
  pushToastWarning: noop,
  pushToastInfo: noop,
  pushToastSuccess: noop,
  pushToastDanger: noop,
  pushUnblockToSend: noop,
  pushYouDoNotHaveThisFeature: noop,
  pushMessageDeleteForbidden: noop,
  pushCannotMixAttachmentTypes: noop,
  pushMaximumAttachmentsError: noop,
  pushFileSizeErrorAsByte: noop,
  pushFileSizeError: noop,
  pushMultipleNonImageError: noop,
  pushAudioPermissionNeeded: noop,
  pushVideoPermissionNeeded: noop,
  pushNoCameraPermission: noop,
  pushMicroPermissionNeeded: noop,
  pushCallAlreadyExists: noop,
};
