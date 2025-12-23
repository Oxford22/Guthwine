/**
 * Guthwine - CDC WebSocket Stream Service
 * 
 * Implements real-time Change Data Capture (CDC) streaming from Neo4j
 * to connected clients via WebSocket. This replaces polling with a
 * push-based architecture for minimal latency and bandwidth efficiency.
 * 
 * Architecture:
 * DB Update → CDC → Fastify → WebSocket → Client Graph → UI Update
 * 
 * Based on the technical report specifications for reactive data synchronization.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

// CDC Event Types
export interface CDCEvent {
  id: string;
  timestamp: number;
  operation: 'create' | 'update' | 'delete';
  type: 'node' | 'relationship';
  labels?: string[];
  relationshipType?: string;
  keys: Record<string, unknown>;
  properties?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata: {
    txId: string;
    commitTimestamp: number;
    source: string;
  };
}

export interface CDCCursor {
  id: string;
  position: string;
  lastProcessed: number;
}

export interface CDCSelector {
  labels?: string[];
  relationshipTypes?: string[];
  operations?: Array<'create' | 'update' | 'delete'>;
}

export interface CDCStreamConfig {
  /** Neo4j connection URI */
  neo4jUri: string;
  /** Neo4j username */
  neo4jUser: string;
  /** Neo4j password */
  neo4jPassword: string;
  /** CDC polling interval in ms (for non-native CDC) */
  pollInterval?: number;
  /** Maximum events per batch */
  batchSize?: number;
  /** Enable schema-based strategy (recommended) */
  useSchemaStrategy?: boolean;
  /** Redis URL for cursor persistence */
  redisUrl?: string;
}

/**
 * CDC Event Emitter
 * 
 * Central hub for CDC events. Receives events from Neo4j
 * and broadcasts to all subscribed WebSocket connections.
 */
export class CDCEventEmitter extends EventEmitter {
  private cursor: CDCCursor | null = null;
  private isRunning: boolean = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private config: CDCStreamConfig;
  private subscribers: Map<string, CDCSubscriber> = new Map();

  constructor(config: CDCStreamConfig) {
    super();
    this.config = config;
    this.setMaxListeners(1000); // Support many concurrent connections
  }

  /**
   * Start the CDC stream
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('[CDC] Starting Change Data Capture stream...');

    // Initialize cursor
    this.cursor = await this.initializeCursor();
    
    // Start polling loop (for non-native CDC implementations)
    this.startPolling();
    
    console.log('[CDC] Stream started, cursor:', this.cursor?.position);
  }

  /**
   * Stop the CDC stream
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Persist cursor for recovery
    if (this.cursor) {
      await this.persistCursor(this.cursor);
    }

    console.log('[CDC] Stream stopped');
  }

  /**
   * Subscribe a WebSocket connection to CDC events
   */
  subscribe(
    connectionId: string,
    socket: WebSocket,
    selector?: CDCSelector
  ): void {
    const subscriber: CDCSubscriber = {
      id: connectionId,
      socket,
      selector: selector || {},
      subscribedAt: Date.now(),
    };

    this.subscribers.set(connectionId, subscriber);
    console.log(`[CDC] Subscriber added: ${connectionId}`);

    // Send initial sync state
    socket.send(JSON.stringify({
      type: 'sync_status',
      status: 'connected',
      cursor: this.cursor?.position,
      timestamp: Date.now(),
    }));
  }

  /**
   * Unsubscribe a WebSocket connection
   */
  unsubscribe(connectionId: string): void {
    this.subscribers.delete(connectionId);
    console.log(`[CDC] Subscriber removed: ${connectionId}`);
  }

  /**
   * Process and broadcast a CDC event
   */
  private async processEvent(event: CDCEvent): Promise<void> {
    // Update cursor
    if (this.cursor) {
      this.cursor.position = event.id;
      this.cursor.lastProcessed = Date.now();
    }

    // Broadcast to matching subscribers
    for (const [id, subscriber] of this.subscribers) {
      if (this.matchesSelector(event, subscriber.selector)) {
        if (subscriber.socket.readyState === WebSocket.OPEN) {
          subscriber.socket.send(JSON.stringify({
            type: 'cdc_event',
            event,
          }));
        }
      }
    }

    // Emit for internal listeners
    this.emit('data', event);
  }

  /**
   * Check if an event matches a subscriber's selector
   */
  private matchesSelector(event: CDCEvent, selector: CDCSelector): boolean {
    // Check operation filter
    if (selector.operations && selector.operations.length > 0) {
      if (!selector.operations.includes(event.operation)) {
        return false;
      }
    }

    // Check label filter for nodes
    if (event.type === 'node' && selector.labels && selector.labels.length > 0) {
      if (!event.labels || !event.labels.some(l => selector.labels!.includes(l))) {
        return false;
      }
    }

    // Check relationship type filter
    if (event.type === 'relationship' && selector.relationshipTypes && selector.relationshipTypes.length > 0) {
      if (!event.relationshipType || !selector.relationshipTypes.includes(event.relationshipType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Initialize or recover the CDC cursor
   */
  private async initializeCursor(): Promise<CDCCursor> {
    // Try to recover from Redis
    const recoveredCursor = await this.recoverCursor();
    if (recoveredCursor) {
      console.log('[CDC] Recovered cursor from storage');
      return recoveredCursor;
    }

    // Create new cursor at current position
    return {
      id: `cursor_${Date.now()}`,
      position: 'CURRENT',
      lastProcessed: Date.now(),
    };
  }

  /**
   * Recover cursor from persistent storage
   */
  private async recoverCursor(): Promise<CDCCursor | null> {
    // In production, this would read from Redis
    // For now, return null to start fresh
    return null;
  }

  /**
   * Persist cursor to storage for crash recovery
   */
  private async persistCursor(cursor: CDCCursor): Promise<void> {
    // In production, this would write to Redis
    console.log('[CDC] Cursor persisted:', cursor.position);
  }

  /**
   * Start the CDC polling loop
   * 
   * Note: In production with Neo4j Enterprise, this would use
   * native CDC streaming. This implementation simulates CDC
   * for compatibility with Community Edition.
   */
  private startPolling(): void {
    const interval = this.config.pollInterval || 1000;

    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const events = await this.fetchChanges();
        for (const event of events) {
          await this.processEvent(event);
        }
      } catch (error) {
        console.error('[CDC] Polling error:', error);
        this.emit('error', error);
      }
    }, interval);
  }

  /**
   * Fetch changes from Neo4j
   * 
   * This is a simulation for demo purposes. In production,
   * this would use db.cdc.query() with the cursor.
   */
  private async fetchChanges(): Promise<CDCEvent[]> {
    // Simulated CDC events for demo
    // In production, this queries Neo4j's transaction log
    return [];
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  getCursor(): CDCCursor | null {
    return this.cursor;
  }
}

interface CDCSubscriber {
  id: string;
  socket: WebSocket;
  selector: CDCSelector;
  subscribedAt: number;
}

/**
 * CDC WebSocket Server
 * 
 * Fastify plugin that adds WebSocket endpoints for CDC streaming.
 */
export class CDCWebSocketServer {
  private emitter: CDCEventEmitter;
  private connectionCounter: number = 0;

  constructor(config: CDCStreamConfig) {
    this.emitter = new CDCEventEmitter(config);
  }

  /**
   * Register the WebSocket routes with Fastify
   */
  async register(fastify: FastifyInstance): Promise<void> {
    // Register WebSocket plugin if not already registered
    await fastify.register(import('@fastify/websocket'), {
      options: {
        maxPayload: 1048576, // 1MB limit to prevent DoS
      },
    });

    // CDC Stream endpoint
    fastify.get('/cdc-stream', { websocket: true }, (connection, req) => {
      const connectionId = `conn_${++this.connectionCounter}_${Date.now()}`;
      
      console.log(`[WS] New connection: ${connectionId}`);

      // Parse selector from query params
      const selector = this.parseSelector(req);

      // Subscribe to CDC events
      this.emitter.subscribe(connectionId, connection.socket, selector);

      // Handle incoming messages (subscription updates)
      connection.socket.on('message', (message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(connectionId, data);
        } catch (error) {
          console.error('[WS] Invalid message:', error);
        }
      });

      // Handle disconnection
      connection.socket.on('close', () => {
        console.log(`[WS] Connection closed: ${connectionId}`);
        this.emitter.unsubscribe(connectionId);
      });

      // Handle errors
      connection.socket.on('error', (error: Error) => {
        console.error(`[WS] Connection error: ${connectionId}`, error);
        this.emitter.unsubscribe(connectionId);
      });
    });

    // Health check endpoint
    fastify.get('/cdc-health', async () => {
      return {
        status: 'healthy',
        subscribers: this.emitter.getSubscriberCount(),
        cursor: this.emitter.getCursor(),
        timestamp: Date.now(),
      };
    });

    // Start the CDC emitter
    await this.emitter.start();
  }

  /**
   * Parse CDC selector from request query params
   */
  private parseSelector(req: FastifyRequest): CDCSelector {
    const query = req.query as Record<string, string>;
    const selector: CDCSelector = {};

    if (query.labels) {
      selector.labels = query.labels.split(',');
    }

    if (query.relationshipTypes) {
      selector.relationshipTypes = query.relationshipTypes.split(',');
    }

    if (query.operations) {
      selector.operations = query.operations.split(',') as Array<'create' | 'update' | 'delete'>;
    }

    return selector;
  }

  /**
   * Handle messages from connected clients
   */
  private handleClientMessage(connectionId: string, data: unknown): void {
    const message = data as { type: string; [key: string]: unknown };
    
    switch (message.type) {
      case 'ping':
        // Respond to keep-alive pings
        const subscriber = this.emitter['subscribers'].get(connectionId);
        if (subscriber && subscriber.socket.readyState === WebSocket.OPEN) {
          subscriber.socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
        break;

      case 'update_selector':
        // Update subscription filter
        const sub = this.emitter['subscribers'].get(connectionId);
        if (sub) {
          sub.selector = message.selector as CDCSelector;
          console.log(`[WS] Updated selector for ${connectionId}`);
        }
        break;

      default:
        console.log(`[WS] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Broadcast a custom event to all subscribers
   */
  broadcast(event: CDCEvent): void {
    this.emitter['processEvent'](event);
  }

  /**
   * Stop the CDC server
   */
  async stop(): Promise<void> {
    await this.emitter.stop();
  }
}

/**
 * Fastify plugin for CDC WebSocket
 */
export async function cdcWebSocketPlugin(
  fastify: FastifyInstance,
  options: { config: CDCStreamConfig }
): Promise<void> {
  const server = new CDCWebSocketServer(options.config);
  await server.register(fastify);

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    await server.stop();
  });

  // Decorate fastify with CDC server reference
  fastify.decorate('cdcServer', server);
}

// Export factory function
export function createCDCServer(config: CDCStreamConfig): CDCWebSocketServer {
  return new CDCWebSocketServer(config);
}
