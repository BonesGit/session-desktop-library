import { join } from 'path';
import { getAppRootPath } from '../../../node/getRootPath';
import { WorkerInterface } from '../../worker_interface';

let utilWorkerInterface: WorkerInterface | undefined;

type WorkerAllowedFunctionName =
  | 'arrayBufferToStringBase64'
  | 'decryptAttachmentBufferNode'
  | 'encryptAttachmentBufferNode'
  | 'DecryptAESGCM'
  | 'fromBase64ToArrayBuffer'
  | 'verifyAllSignatures'
  | 'encryptForPubkey';

const internalCallUtilsWorker = async (
  fnName: WorkerAllowedFunctionName,
  ...args: any
): Promise<any> => {
  if (!utilWorkerInterface) {
    // In library mode (Node.js worker_threads) the webpack-compiled bundle uses
    // browser globals (onmessage/postMessage). Use the node-wrapper which polyfills
    // those globals before loading the bundle. In Electron mode use compiled.js directly.
    const isLibraryMode = typeof process !== 'undefined' && process.type !== 'renderer';
    const workerFile = isLibraryMode ? 'util.worker.node-wrapper.js' : 'util.worker.compiled.js';
    const utilWorkerPath = join(
      getAppRootPath(),
      'ts',
      'webworker',
      'workers',
      'node',
      'util',
      workerFile
    );
    utilWorkerInterface = new WorkerInterface(utilWorkerPath, 3 * 60 * 1000);
  }
  return utilWorkerInterface?.callWorker(fnName, ...args);
};

export const callUtilsWorker = async (
  fnName: WorkerAllowedFunctionName,
  ...args: any
): Promise<any> => {
  return internalCallUtilsWorker(fnName, ...args);
};
