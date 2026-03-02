/**
 * Singleton internal EventEmitter used to bridge backend Redux dispatches
 * and Whisper events into SessionClient public events.
 *
 * This is separate from the public SessionClient emitter so the library's
 * internal bus is not exposed to consumers.
 */

import { EventEmitter } from 'events';

export const internalEmitter = new EventEmitter();
internalEmitter.setMaxListeners(100);
