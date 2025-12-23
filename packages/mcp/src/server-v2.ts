/**
 * MCP Server v2 - Production Mode
 * 
 * Features:
 * - Multiple transports (stdio, SSE, WebSocket)
 * - Per-agent rate limiting
 * - Request signing verification
 * - Graceful shutdown handling
 * - Health checks and metrics
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';

// =============================================================================
// TYPES
// =============================================================================

export interface MCPServerConfig {
  name: string;
  version: string;
  transport: 'stdio' | 'sse' | 'websocket';
  
  // Rate limiting
  rateLimiting?: {
    enabled: boolean;
    requestsPerMinute: number;
    requestsPerHour: number;
    burstLimit: number;
  };
  
  // Request signing
  requestSigning?: {
    enabled: boolean;
    algorithm: 'ed25519' | 'hmac-sha256';
    publicKeys: Map<string, string>; // agentId -> publicKey
  };
  
  // HTTP/SSE config
  http?: {
    port: number;
    host: string;
    cors?: {
      origins: string[];
      methods: string[];
    };
    tls?: {
      cert: string;
      key: string;
    };
  };
  
  // WebSocket config
  websocket?: {
    port: number;
    host: string;
    pingInterval: number;
    maxConnections: number;
  };
  
  // Graceful shutdown
  shutdown?: {
    timeout: number;
    signals: string[];
  };
}

export interface RateLimitState {
  agentId: string;
  minuteCount: number;
  hourCount: number;
  minuteReset: number;
  hourReset: number;
  burstTokens: number;
  lastRequest: number;
}

export interface MCPMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  rateLimitedRequests: number;
  averageLatencyMs: number;
  activeConnections: number;
  requestsByTool: Record<string, number>;
  requestsByAgent: Record<string, number>;
}

export interface SignedRequest {
  payload: string;
  signature: string;
  agentId: string;
  timestamp: number;
  nonce: string;
}

// =============================================================================
// RATE LIMITER
// =============================================================================

export class MCPRateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  private config: NonNullable<MCPServerConfig['rateLimiting']>;

  constructor(config: NonNullable<MCPServerConfig['rateLimiting']>) {
    this.config = config;
  }

  /**
   * Check if a request is allowed
   */
  checkLimit(agentId: string): { allowed: boolean; retryAfter?: number } {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const now = Date.now();
    let state = this.states.get(agentId);

    if (!state) {
      state = {
        agentId,
        minuteCount: 0,
        hourCount: 0,
        minuteReset: now + 60000,
        hourReset: now + 3600000,
        burstTokens: this.config.burstLimit,
        lastRequest: now,
      };
      this.states.set(agentId, state);
    }

    // Reset counters if windows have passed
    if (now > state.minuteReset) {
      state.minuteCount = 0;
      state.minuteReset = now + 60000;
    }
    if (now > state.hourReset) {
      state.hourCount = 0;
      state.hourReset = now + 3600000;
    }

    // Replenish burst tokens (1 per second)
    const secondsSinceLastRequest = (now - state.lastRequest) / 1000;
    state.burstTokens = Math.min(
      this.config.burstLimit,
      state.burstTokens + Math.floor(secondsSinceLastRequest)
    );

    // Check limits
    if (state.minuteCount >= this.config.requestsPerMinute) {
      return { allowed: false, retryAfter: Math.ceil((state.minuteReset - now) / 1000) };
    }
    if (state.hourCount >= this.config.requestsPerHour) {
      return { allowed: false, retryAfter: Math.ceil((state.hourReset - now) / 1000) };
    }
    if (state.burstTokens <= 0) {
      return { allowed: false, retryAfter: 1 };
    }

    // Consume tokens
    state.minuteCount++;
    state.hourCount++;
    state.burstTokens--;
    state.lastRequest = now;

    return { allowed: true };
  }

  /**
   * Get current state for an agent
   */
  getState(agentId: string): RateLimitState | undefined {
    return this.states.get(agentId);
  }

  /**
   * Reset limits for an agent
   */
  resetLimits(agentId: string): void {
    this.states.delete(agentId);
  }

  /**
   * Get all rate limit states
   */
  getAllStates(): Map<string, RateLimitState> {
    return new Map(this.states);
  }
}

// =============================================================================
// REQUEST SIGNER/VERIFIER
// =============================================================================

export class RequestSigner {
  private config: NonNullable<MCPServerConfig['requestSigning']>;
  private usedNonces: Set<string> = new Set();

  constructor(config: NonNullable<MCPServerConfig['requestSigning']>) {
    this.config = config;
  }

  /**
   * Verify a signed request
   */
  verifyRequest(request: SignedRequest): { valid: boolean; error?: string } {
    if (!this.config.enabled) {
      return { valid: true };
    }

    // Check timestamp (5 minute window)
    const now = Date.now();
    if (Math.abs(now - request.timestamp) > 300000) {
      return { valid: false, error: 'Request timestamp too old or in future' };
    }

    // Check nonce
    if (this.usedNonces.has(request.nonce)) {
      return { valid: false, error: 'Nonce already used' };
    }

    // Get public key for agent
    const publicKey = this.config.publicKeys.get(request.agentId);
    if (!publicKey) {
      return { valid: false, error: 'Unknown agent ID' };
    }

    // Verify signature
    const signatureInput = `${request.timestamp}.${request.nonce}.${request.payload}`;
    
    try {
      if (this.config.algorithm === 'ed25519') {
        const isValid = crypto.verify(
          null,
          Buffer.from(signatureInput),
          {
            key: Buffer.from(publicKey, 'base64'),
            format: 'der',
            type: 'spki',
          },
          Buffer.from(request.signature, 'base64')
        );
        
        if (!isValid) {
          return { valid: false, error: 'Invalid signature' };
        }
      } else if (this.config.algorithm === 'hmac-sha256') {
        const expectedSig = crypto
          .createHmac('sha256', publicKey)
          .update(signatureInput)
          .digest('base64');
        
        if (!crypto.timingSafeEqual(
          Buffer.from(request.signature),
          Buffer.from(expectedSig)
        )) {
          return { valid: false, error: 'Invalid signature' };
        }
      }
    } catch (error) {
      return { valid: false, error: `Signature verification failed: ${error}` };
    }

    // Store nonce
    this.usedNonces.add(request.nonce);

    // Cleanup old nonces periodically
    if (this.usedNonces.size > 10000) {
      this.usedNonces.clear();
    }

    return { valid: true };
  }

  /**
   * Register a new agent's public key
   */
  registerAgent(agentId: string, publicKey: string): void {
    this.config.publicKeys.set(agentId, publicKey);
  }

  /**
   * Remove an agent's public key
   */
  unregisterAgent(agentId: string): void {
    this.config.publicKeys.delete(agentId);
  }
}

// =============================================================================
// SSE TRANSPORT
// =============================================================================

export class SSETransport extends EventEmitter {
  private server: http.Server | https.Server | null = null;
  private clients: Map<string, http.ServerResponse> = new Map();
  private config: NonNullable<MCPServerConfig['http']>;

  constructor(config: NonNullable<MCPServerConfig['http']>) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      // CORS headers
      if (this.config.cors) {
        const origin = req.headers.origin ?? '';
        if (this.config.cors.origins.includes(origin) || this.config.cors.origins.includes('*')) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Access-Control-Allow-Methods', this.config.cors.methods.join(', '));
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Agent-ID');
        }
      }

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // Health check endpoint
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }

      // SSE endpoint
      if (url.pathname === '/sse' && req.method === 'GET') {
        const agentId = req.headers['x-agent-id'] as string ?? crypto.randomUUID();
        
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        // Send initial connection event
        res.write(`event: connected\ndata: ${JSON.stringify({ agentId })}\n\n`);

        this.clients.set(agentId, res);
        this.emit('connection', agentId);

        req.on('close', () => {
          this.clients.delete(agentId);
          this.emit('disconnection', agentId);
        });

        return;
      }

      // Message endpoint
      if (url.pathname === '/message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const message = JSON.parse(body);
            const agentId = req.headers['x-agent-id'] as string ?? 'anonymous';
            this.emit('message', { agentId, message });
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: true }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      // 404 for other paths
      res.writeHead(404);
      res.end('Not Found');
    };

    if (this.config.tls) {
      this.server = https.createServer({
        cert: this.config.tls.cert,
        key: this.config.tls.key,
      }, handler);
    } else {
      this.server = http.createServer(handler);
    }

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const [agentId, res] of this.clients) {
      res.end();
      this.clients.delete(agentId);
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Send a message to a specific agent
   */
  sendToAgent(agentId: string, event: string, data: unknown): boolean {
    const client = this.clients.get(agentId);
    if (!client) return false;

    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  /**
   * Broadcast a message to all connected agents
   */
  broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      client.write(message);
    }
  }

  /**
   * Get connected client count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }
}

// =============================================================================
// WEBSOCKET TRANSPORT
// =============================================================================

export class WebSocketTransport extends EventEmitter {
  private server: http.Server | null = null;
  private clients: Map<string, any> = new Map(); // WebSocket connections
  private config: NonNullable<MCPServerConfig['websocket']>;
  private pingIntervalId: NodeJS.Timeout | null = null;

  constructor(config: NonNullable<MCPServerConfig['websocket']>) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    // Note: In production, you'd use the 'ws' package
    // This is a simplified implementation
    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(426);
      res.end('Upgrade Required');
    });

    // Start ping interval
    this.pingIntervalId = setInterval(() => {
      for (const [agentId, ws] of this.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          this.clients.delete(agentId);
          this.emit('disconnection', agentId);
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, this.config.pingInterval);

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
    }

    // Close all WebSocket connections
    for (const [agentId, ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
      this.clients.delete(agentId);
    }

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Send a message to a specific agent
   */
  sendToAgent(agentId: string, data: unknown): boolean {
    const client = this.clients.get(agentId);
    if (!client) return false;

    client.send(JSON.stringify(data));
    return true;
  }

  /**
   * Broadcast a message to all connected agents
   */
  broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const client of this.clients.values()) {
      client.send(message);
    }
  }

  /**
   * Get connected client count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }
}

// =============================================================================
// MCP SERVER V2
// =============================================================================

export class MCPServerV2 {
  private server: Server;
  private config: MCPServerConfig;
  private rateLimiter: MCPRateLimiter | null = null;
  private requestSigner: RequestSigner | null = null;
  private transport: StdioServerTransport | SSETransport | WebSocketTransport | null = null;
  private metrics: MCPMetrics;
  private isShuttingDown = false;
  private toolHandlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>> = new Map();

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.server = new Server(
      { name: config.name, version: config.version },
      { capabilities: { tools: {} } }
    );

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
      averageLatencyMs: 0,
      activeConnections: 0,
      requestsByTool: {},
      requestsByAgent: {},
    };

    // Initialize rate limiter
    if (config.rateLimiting) {
      this.rateLimiter = new MCPRateLimiter(config.rateLimiting);
    }

    // Initialize request signer
    if (config.requestSigning) {
      this.requestSigner = new RequestSigner(config.requestSigning);
    }

    this.setupHandlers();
    this.setupShutdownHandlers();
  }

  private setupHandlers(): void {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.toolHandlers.keys()).map(name => ({
          name,
          description: `Tool: ${name}`,
          inputSchema: { type: 'object' as const, properties: {} },
        })),
      };
    });

    // Call tool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;
      const agentId = (args._agentId as string) ?? 'anonymous';

      this.metrics.totalRequests++;
      this.metrics.requestsByTool[toolName] = (this.metrics.requestsByTool[toolName] ?? 0) + 1;
      this.metrics.requestsByAgent[agentId] = (this.metrics.requestsByAgent[agentId] ?? 0) + 1;

      // Check rate limit
      if (this.rateLimiter) {
        const limitResult = this.rateLimiter.checkLimit(agentId);
        if (!limitResult.allowed) {
          this.metrics.rateLimitedRequests++;
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Rate limit exceeded',
                retryAfter: limitResult.retryAfter,
              }),
            }],
            isError: true,
          };
        }
      }

      // Verify request signature if enabled
      if (this.requestSigner && args._signature) {
        const signedRequest: SignedRequest = {
          payload: JSON.stringify({ name: toolName, arguments: args }),
          signature: args._signature as string,
          agentId,
          timestamp: args._timestamp as number ?? Date.now(),
          nonce: args._nonce as string ?? '',
        };

        const verifyResult = this.requestSigner.verifyRequest(signedRequest);
        if (!verifyResult.valid) {
          this.metrics.failedRequests++;
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Request signature verification failed',
                details: verifyResult.error,
              }),
            }],
            isError: true,
          };
        }
      }

      // Execute tool
      const handler = this.toolHandlers.get(toolName);
      if (!handler) {
        this.metrics.failedRequests++;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
          }],
          isError: true,
        };
      }

      try {
        const result = await handler(args);
        this.metrics.successfulRequests++;
        
        // Update average latency
        const latency = Date.now() - startTime;
        this.metrics.averageLatencyMs = 
          (this.metrics.averageLatencyMs * (this.metrics.totalRequests - 1) + latency) / 
          this.metrics.totalRequests;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result),
          }],
        };
      } catch (error: any) {
        this.metrics.failedRequests++;
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: error.message ?? 'Tool execution failed',
            }),
          }],
          isError: true,
        };
      }
    });
  }

  private setupShutdownHandlers(): void {
    const signals = this.config.shutdown?.signals ?? ['SIGTERM', 'SIGINT'];
    const timeout = this.config.shutdown?.timeout ?? 30000;

    for (const signal of signals) {
      process.on(signal, async () => {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.error(`Received ${signal}, starting graceful shutdown...`);

        // Set shutdown timeout
        const timeoutId = setTimeout(() => {
          console.error('Shutdown timeout exceeded, forcing exit');
          process.exit(1);
        }, timeout);

        try {
          await this.stop();
          clearTimeout(timeoutId);
          console.error('Graceful shutdown complete');
          process.exit(0);
        } catch (error) {
          console.error('Error during shutdown:', error);
          clearTimeout(timeoutId);
          process.exit(1);
        }
      });
    }
  }

  /**
   * Register a tool handler
   */
  registerTool(
    name: string,
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.toolHandlers.set(name, handler);
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    switch (this.config.transport) {
      case 'stdio':
        this.transport = new StdioServerTransport();
        await this.server.connect(this.transport);
        break;

      case 'sse':
        if (!this.config.http) {
          throw new Error('HTTP config required for SSE transport');
        }
        this.transport = new SSETransport(this.config.http);
        await (this.transport as SSETransport).start();
        
        // Connect SSE events to server
        (this.transport as SSETransport).on('message', ({ agentId, message }) => {
          // Process incoming messages
          console.error(`Message from ${agentId}:`, message);
        });
        break;

      case 'websocket':
        if (!this.config.websocket) {
          throw new Error('WebSocket config required for WebSocket transport');
        }
        this.transport = new WebSocketTransport(this.config.websocket);
        await (this.transport as WebSocketTransport).start();
        break;
    }

    console.error(`MCP Server v2 started (${this.config.transport} transport)`);
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (this.transport instanceof SSETransport || this.transport instanceof WebSocketTransport) {
      await this.transport.stop();
    }
    await this.server.close();
    console.error('MCP Server v2 stopped');
  }

  /**
   * Get current metrics
   */
  getMetrics(): MCPMetrics {
    if (this.transport instanceof SSETransport || this.transport instanceof WebSocketTransport) {
      this.metrics.activeConnections = this.transport.getConnectionCount();
    }
    return { ...this.metrics };
  }

  /**
   * Get rate limiter
   */
  getRateLimiter(): MCPRateLimiter | null {
    return this.rateLimiter;
  }

  /**
   * Get request signer
   */
  getRequestSigner(): RequestSigner | null {
    return this.requestSigner;
  }

  /**
   * Check if server is healthy
   */
  isHealthy(): boolean {
    return !this.isShuttingDown;
  }
}

/**
 * Create an MCP Server v2 instance
 */
export function createMCPServerV2(config: MCPServerConfig): MCPServerV2 {
  return new MCPServerV2(config);
}

/**
 * Create default MCP server config
 */
export function getDefaultMCPConfig(): MCPServerConfig {
  return {
    name: 'guthwine-mcp',
    version: '2.0.0',
    transport: 'stdio',
    rateLimiting: {
      enabled: true,
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      burstLimit: 10,
    },
    requestSigning: {
      enabled: false,
      algorithm: 'ed25519',
      publicKeys: new Map(),
    },
    shutdown: {
      timeout: 30000,
      signals: ['SIGTERM', 'SIGINT'],
    },
  };
}
