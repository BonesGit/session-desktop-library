/**
 * Node.js worker_threads-based replacement for ts/webworker/worker_interface.ts
 *
 * The Electron app uses the browser Web Worker API (new Worker(path), worker.onmessage, etc.).
 * In the library build, we use Node.js worker_threads instead.
 *
 * This module exports a WorkerInterface class with the same API as the browser version
 * so that ts/webworker/workers/browser/libsession_worker_interface.ts works unchanged.
 */

import { Worker } from 'worker_threads';

const WORKER_TIMEOUT = 60 * 1000; // one minute

class TimedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class WorkerInterface {
  private readonly timeout: number;
  private readonly _DEBUG: boolean;
  private _jobCounter: number;
  private readonly _jobs: Record<number, {
    fnName: string;
    start: number;
    resolve?: (value: unknown) => void;
    reject?: (reason: unknown) => void;
    args?: unknown;
  }>;
  private readonly _worker: Worker;

  constructor(workerPath: string, timeout = WORKER_TIMEOUT) {
    this._worker = new Worker(workerPath);
    this.timeout = timeout;
    this._jobs = Object.create(null) as Record<number, never>;
    this._DEBUG = false;
    this._jobCounter = 0;

    this._worker.on('message', (data: [number, string | null, unknown]) => {
      const [jobId, errorForDisplay, result] = data;

      const job = this._getJob(jobId);
      if (!job) {
        throw new Error(
          `Received worker reply to job ${jobId}, but did not have it in our registry!`
        );
      }

      const { resolve, reject, fnName } = job;

      if (errorForDisplay) {
        window?.log?.error(`Error received from worker job ${jobId} (${fnName}):`, errorForDisplay);
        reject?.(new Error(errorForDisplay));
        return;
      }

      resolve?.(result);
    });

    this._worker.on('error', (err: Error) => {
      // Log with full stack so the root cause is visible immediately
      // pino needs object-first syntax to serialize error details
      window?.log?.error(
        { workerPath, errMessage: err.message, errStack: err.stack ?? '' },
        '[workerInterfaceNode] Worker error'
      );
      // Reject all pending jobs so callers fail fast instead of hanging to timeout
      for (const id of Object.keys(this._jobs)) {
        const job = this._jobs[Number(id)];
        job.reject?.(err);
        delete this._jobs[Number(id)];
      }
    });

    this._worker.on('exit', (code: number) => {
      if (code !== 0) {
        const err = new Error(`[workerInterfaceNode] Worker exited with code ${code}`);
        window?.log?.error({ code, workerPath }, err.message);
        for (const id of Object.keys(this._jobs)) {
          const job = this._jobs[Number(id)];
          job.reject?.(err);
          delete this._jobs[Number(id)];
        }
      }
    });
  }

  public async callWorker(fnName: string, ...args: Array<unknown>): Promise<unknown> {
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
      window?.log?.info(`Worker job ${id} (${fnName}) started`);
    }
    this._jobs[id] = {
      fnName,
      start: Date.now(),
    };

    return id;
  }

  private _updateJob(id: number, data: { resolve?: (v: unknown) => void; reject?: (r: unknown) => void; args?: unknown }) {
    const { resolve, reject } = data;
    const { fnName, start } = this._jobs[id];

    this._jobs[id] = {
      ...this._jobs[id],
      ...data,
      resolve: (value: unknown) => {
        this._removeJob(id);
        const end = Date.now();
        if (this._DEBUG) {
          window?.log?.info(`Worker job ${id} (${fnName}) succeeded in ${end - start}ms`);
        }
        resolve?.(value);
      },
      reject: (error: unknown) => {
        this._removeJob(id);
        const end = Date.now();
        window?.log?.debug(
          `Worker job ${id} (${fnName}) failed in ${end - start}ms with ${(error as Error).message}`
        );
        reject?.(error);
      },
    };
  }

  private _removeJob(id: number) {
    const job = this._jobs[id];
    delete this._jobs[id];
    return job;
  }

  private _getJob(id: number) {
    return this._jobs[id];
  }

  public terminate(): void {
    void this._worker.terminate();
  }
}
