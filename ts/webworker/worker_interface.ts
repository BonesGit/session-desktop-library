const WORKER_TIMEOUT = 60 * 1000; // one minute

// Detect whether we're in a Node.js (library) context or a browser/Electron renderer context
const _isNodeContext = typeof Worker === 'undefined';

// In Node.js context, use worker_threads.Worker; otherwise use the browser Web Worker API
type AnyWorker = Worker | import('worker_threads').Worker;

class TimedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

export class WorkerInterface {
  private readonly timeout: number;
  private readonly _DEBUG: boolean;
  private _jobCounter: number;
  private readonly _jobs: Record<number, any>;
  private readonly _worker: AnyWorker;

  constructor(path: string, timeout = WORKER_TIMEOUT) {
    this.timeout = timeout;
    this._DEBUG = false;
    this._jobCounter = 0;
    this._jobs = {};

    if (_isNodeContext) {
      // Library build: use Node.js worker_threads
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Worker: NodeWorker } = require('worker_threads') as typeof import('worker_threads');
      const nodeWorker = new NodeWorker(path);
      this._worker = nodeWorker as unknown as Worker;
      nodeWorker.on('message', (data: [number, string | null, unknown]) => {
        const [jobId, errorForDisplay, result] = data;
        this._handleMessage(jobId, errorForDisplay, result);
      });
      nodeWorker.on('error', (err: Error) => {
        window?.log?.error(
          { errMessage: err.message, errStack: err.stack ?? '' },
          `[WorkerInterface] Worker error for ${path}`
        );
        // Reject all pending jobs so callers fail fast instead of hanging until timeout
        for (const id of Object.keys(this._jobs)) {
          const job = this._jobs[Number(id)];
          job?.reject?.(err);
          delete this._jobs[Number(id)];
        }
      });
      nodeWorker.on('exit', (code: number) => {
        if (code !== 0) {
          const err2 = new Error(`[WorkerInterface] Worker exited with code ${code} for ${path}`);
          window?.log?.error({ code }, err2.message);
          for (const id of Object.keys(this._jobs)) {
            const job = this._jobs[Number(id)];
            job?.reject?.(err2);
            delete this._jobs[Number(id)];
          }
        }
      });
    } else {
      // Electron renderer: prevent unsafe native module loading in browser workers
      (process as any).dlopen = () => {
        throw new Error('Load native module is not safe');
      };
      // Electron renderer: use browser Web Worker API
      this._worker = new Worker(path);
      (this._worker as Worker).onmessage = e => {
        const [jobId, errorForDisplay, result] = e.data;
        this._handleMessage(jobId, errorForDisplay, result);
      };
    }
  }

  private _handleMessage(jobId: number, errorForDisplay: string | null, result: unknown) {
    const job = this._getJob(jobId);
    if (!job) {
      throw new Error(
        `Received worker reply to job ${jobId}, but did not have it in our registry!`
      );
    }

    const { resolve, reject, fnName } = job;

    if (errorForDisplay) {
      window?.log?.error(`Error received from worker job ${jobId} (${fnName}):`, errorForDisplay);
      // Note: don't wrap this with a prefix as we want to be able to show what was the error as is to the user in a toast.
      // If you want to add something, add it at the end.
      return reject(new Error(errorForDisplay));
    }

    return resolve(result);
  }

  public async callWorker(fnName: string, ...args: any) {
    const jobId = this._makeJob(fnName);

    return new Promise((resolve, reject) => {
      this._worker.postMessage([jobId, fnName, ...args]);

      this._updateJob(jobId, {
        resolve,
        reject,
        args: this._DEBUG ? args : null,
      });

      setTimeout(() => {
        reject(new TimedOutError(`Worker job ${jobId} (${fnName}) timed out`));
      }, this.timeout);
    });
  }

  private _makeJob(fnName: string): number {
    this._jobCounter += 1;
    const id = this._jobCounter;

    if (this._DEBUG) {
      window.log.info(`Worker job ${id} (${fnName}) started`);
    }
    this._jobs[id] = {
      fnName,
      start: Date.now(),
    };

    return id;
  }

  private _updateJob(id: number, data: any) {
    const { resolve, reject } = data;
    const { fnName, start } = this._jobs[id];

    this._jobs[id] = {
      ...this._jobs[id],
      ...data,
      resolve: (value: any) => {
        this._removeJob(id);
        const end = Date.now();
        if (this._DEBUG) {
          window.log.info(`Worker job ${id} (${fnName}) succeeded in ${end - start}ms`);
        }
        return resolve(value);
      },
      reject: (error: any) => {
        this._removeJob(id);
        const end = Date.now();
        window.log.debug(
          `Worker job ${id} (${fnName}) failed in ${end - start}ms with ${error.message}`
        );
        return reject(error);
      },
    };
  }

  private _removeJob(id: number) {
    if (this._DEBUG) {
      this._jobs[id].complete = true;
      return this._jobs[id];
    }
    const job = this._jobs[id];
    delete this._jobs[id];
    return job;
  }

  private _getJob(id: number) {
    return this._jobs[id];
  }
}
