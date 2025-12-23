/**
 * CDC WebSocket Module
 * 
 * Real-time Change Data Capture streaming via WebSocket.
 */

export {
  CDCEventEmitter,
  CDCWebSocketServer,
  cdcWebSocketPlugin,
  createCDCServer,
  type CDCEvent,
  type CDCCursor,
  type CDCSelector,
  type CDCStreamConfig,
} from './cdc-stream.js';
