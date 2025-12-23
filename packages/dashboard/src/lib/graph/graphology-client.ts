/**
 * Guthwine - Client-Side Graphology Integration
 * 
 * Provides a reactive graph data structure that:
 * 1. Connects to the CDC WebSocket stream
 * 2. Maintains a local graphology instance
 * 3. Triggers Louvain re-computation in Web Worker
 * 4. Exposes React hooks for UI integration
 * 
 * Architecture:
 * WebSocket → GraphologyClient → Web Worker → React State
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// Graph types
export interface GraphNode {
  id: string;
  label?: string;
  type: 'agent' | 'user' | 'organization' | 'transaction';
  attributes: Record<string, unknown>;
  community?: number;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'delegation' | 'transaction' | 'membership';
  weight: number;
  attributes: Record<string, unknown>;
}

export interface GraphState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
  communities: Map<string, number>;
  modularity: number;
  communityCount: number;
  lastUpdate: number;
}

export interface CDCMessage {
  type: 'cdc_event' | 'sync_status' | 'pong';
  event?: CDCEvent;
  status?: string;
  cursor?: string;
  timestamp?: number;
}

export interface CDCEvent {
  id: string;
  operation: 'create' | 'update' | 'delete';
  type: 'node' | 'relationship';
  labels?: string[];
  relationshipType?: string;
  keys: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface GraphologyClientConfig {
  wsUrl: string;
  workerUrl?: string;
  autoConnect?: boolean;
  reconnectInterval?: number;
  louvainThrottle?: number;
}

/**
 * GraphologyClient
 * 
 * Manages the client-side graph state with real-time updates
 * from the CDC WebSocket stream.
 */
export class GraphologyClient {
  private config: GraphologyClientConfig;
  private ws: WebSocket | null = null;
  private worker: Worker | null = null;
  private state: GraphState;
  private listeners: Set<(state: GraphState) => void> = new Set();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private louvainTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private pendingLouvain: boolean = false;

  constructor(config: GraphologyClientConfig) {
    this.config = {
      autoConnect: true,
      reconnectInterval: 5000,
      louvainThrottle: 1000,
      ...config,
    };

    this.state = {
      nodes: new Map(),
      edges: new Map(),
      communities: new Map(),
      modularity: 0,
      communityCount: 0,
      lastUpdate: Date.now(),
    };

    // Initialize Web Worker
    this.initWorker();

    // Auto-connect if enabled
    if (this.config.autoConnect) {
      this.connect();
    }
  }

  /**
   * Initialize the Louvain Web Worker
   */
  private initWorker(): void {
    try {
      // Create worker from URL or inline
      this.worker = new Worker(
        new URL('../workers/louvain.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event) => {
        const { action, success, data, error } = event.data;

        if (action === 'ready') {
          console.log('[Graph] Louvain worker ready');
          return;
        }

        if (!success) {
          console.error('[Graph] Worker error:', error);
          return;
        }

        if (action === 'result') {
          // Update communities in state
          this.state.communities = new Map(Object.entries(data.communities));
          this.state.modularity = data.modularity;
          this.state.communityCount = data.communityCount;
          this.state.lastUpdate = Date.now();

          // Update node community assignments
          for (const [nodeId, community] of this.state.communities) {
            const node = this.state.nodes.get(nodeId);
            if (node) {
              node.community = community;
            }
          }

          this.notifyListeners();
          console.log(`[Graph] Louvain complete: ${data.communityCount} communities, modularity=${data.modularity.toFixed(4)}`);
        }

        if (action === 'anomalies') {
          console.log('[Graph] Anomalies detected:', data.anomalies);
          // Could emit an event or update state with anomalies
        }
      };

      this.worker.onerror = (error) => {
        console.error('[Graph] Worker error:', error);
      };
    } catch (error) {
      console.warn('[Graph] Web Worker not available, running Louvain on main thread');
    }
  }

  /**
   * Connect to the CDC WebSocket stream
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log(`[Graph] Connecting to ${this.config.wsUrl}...`);

    try {
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.onopen = () => {
        console.log('[Graph] WebSocket connected');
        this.isConnected = true;
        
        // Clear reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Start keep-alive
        this.startKeepAlive();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: CDCMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[Graph] Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[Graph] WebSocket disconnected');
        this.isConnected = false;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[Graph] WebSocket error:', error);
      };
    } catch (error) {
      console.error('[Graph] Failed to connect:', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectInterval);
  }

  /**
   * Start keep-alive ping/pong
   */
  private startKeepAlive(): void {
    setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  /**
   * Handle incoming CDC messages
   */
  private handleMessage(message: CDCMessage): void {
    switch (message.type) {
      case 'cdc_event':
        if (message.event) {
          this.processCDCEvent(message.event);
        }
        break;

      case 'sync_status':
        console.log(`[Graph] Sync status: ${message.status}, cursor: ${message.cursor}`);
        break;

      case 'pong':
        // Keep-alive response
        break;
    }
  }

  /**
   * Process a CDC event and update the graph
   */
  private processCDCEvent(event: CDCEvent): void {
    const { operation, type, keys, properties, labels, relationshipType } = event;

    if (type === 'node') {
      const nodeId = keys.uuid as string || keys.id as string;
      
      switch (operation) {
        case 'create':
          if (!this.state.nodes.has(nodeId)) {
            this.state.nodes.set(nodeId, {
              id: nodeId,
              label: properties?.name as string,
              type: this.mapLabelToType(labels),
              attributes: properties || {},
            });
          }
          break;

        case 'update':
          const existing = this.state.nodes.get(nodeId);
          if (existing) {
            existing.attributes = { ...existing.attributes, ...properties };
          }
          break;

        case 'delete':
          this.state.nodes.delete(nodeId);
          // Also remove connected edges
          for (const [edgeId, edge] of this.state.edges) {
            if (edge.source === nodeId || edge.target === nodeId) {
              this.state.edges.delete(edgeId);
            }
          }
          break;
      }
    } else if (type === 'relationship') {
      const edgeId = keys.id as string || `${keys.startNodeId}_${keys.endNodeId}`;
      
      switch (operation) {
        case 'create':
          if (!this.state.edges.has(edgeId)) {
            this.state.edges.set(edgeId, {
              id: edgeId,
              source: keys.startNodeId as string,
              target: keys.endNodeId as string,
              type: this.mapRelationshipType(relationshipType),
              weight: (properties?.weight as number) || 1,
              attributes: properties || {},
            });
          }
          break;

        case 'update':
          const existingEdge = this.state.edges.get(edgeId);
          if (existingEdge) {
            existingEdge.attributes = { ...existingEdge.attributes, ...properties };
          }
          break;

        case 'delete':
          this.state.edges.delete(edgeId);
          break;
      }
    }

    // Trigger Louvain re-computation (throttled)
    this.scheduleLouvain();
    this.notifyListeners();
  }

  /**
   * Map Neo4j labels to node types
   */
  private mapLabelToType(labels?: string[]): GraphNode['type'] {
    if (!labels || labels.length === 0) return 'agent';
    
    const label = labels[0]!.toLowerCase();
    if (label.includes('agent')) return 'agent';
    if (label.includes('user')) return 'user';
    if (label.includes('org')) return 'organization';
    if (label.includes('transaction')) return 'transaction';
    return 'agent';
  }

  /**
   * Map relationship type to edge type
   */
  private mapRelationshipType(type?: string): GraphEdge['type'] {
    if (!type) return 'delegation';
    
    const t = type.toLowerCase();
    if (t.includes('delegat')) return 'delegation';
    if (t.includes('transact')) return 'transaction';
    if (t.includes('member') || t.includes('belongs')) return 'membership';
    return 'delegation';
  }

  /**
   * Schedule Louvain computation (throttled)
   */
  private scheduleLouvain(): void {
    if (this.pendingLouvain) return;
    
    this.pendingLouvain = true;
    
    if (this.louvainTimer) {
      clearTimeout(this.louvainTimer);
    }

    this.louvainTimer = setTimeout(() => {
      this.runLouvain();
      this.pendingLouvain = false;
    }, this.config.louvainThrottle);
  }

  /**
   * Run Louvain algorithm in Web Worker
   */
  runLouvain(): void {
    if (!this.worker) {
      console.warn('[Graph] Worker not available');
      return;
    }

    if (this.state.nodes.size === 0) {
      return;
    }

    // Export graph to worker format
    const topology = {
      nodes: Array.from(this.state.nodes.values()).map(n => ({
        id: n.id,
        attributes: n.attributes,
      })),
      edges: Array.from(this.state.edges.values()).map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      })),
    };

    this.worker.postMessage({
      action: 'optimize',
      topology,
      options: {
        resolution: 1.0,
        maxIterations: 100,
      },
    });
  }

  /**
   * Detect anomalies using community structure
   */
  detectAnomalies(): void {
    if (!this.worker) return;

    const topology = {
      nodes: Array.from(this.state.nodes.values()).map(n => ({
        id: n.id,
        attributes: n.attributes,
      })),
      edges: Array.from(this.state.edges.values()).map(e => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      })),
    };

    this.worker.postMessage({
      action: 'detectAnomalies',
      topology,
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (state: GraphState) => void): () => void {
    this.listeners.add(listener);
    // Immediately call with current state
    listener(this.state);
    
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Get current graph state
   */
  getState(): GraphState {
    return this.state;
  }

  /**
   * Add a node manually (for testing/demo)
   */
  addNode(node: GraphNode): void {
    this.state.nodes.set(node.id, node);
    this.scheduleLouvain();
    this.notifyListeners();
  }

  /**
   * Add an edge manually (for testing/demo)
   */
  addEdge(edge: GraphEdge): void {
    this.state.edges.set(edge.id, edge);
    this.scheduleLouvain();
    this.notifyListeners();
  }

  /**
   * Get nodes grouped by community
   */
  getNodesByCommunity(): Map<number, GraphNode[]> {
    const result = new Map<number, GraphNode[]>();
    
    for (const node of this.state.nodes.values()) {
      const community = node.community ?? -1;
      if (!result.has(community)) {
        result.set(community, []);
      }
      result.get(community)!.push(node);
    }
    
    return result;
  }

  /**
   * Export graph for visualization
   */
  exportForVisualization(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: Array.from(this.state.nodes.values()),
      edges: Array.from(this.state.edges.values()),
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disconnect();
    
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.louvainTimer) {
      clearTimeout(this.louvainTimer);
    }

    this.listeners.clear();
  }
}

// React Hooks

/**
 * React hook for using the GraphologyClient
 */
export function useGraphologyClient(config: GraphologyClientConfig) {
  const clientRef = useRef<GraphologyClient | null>(null);
  const [state, setState] = useState<GraphState>({
    nodes: new Map(),
    edges: new Map(),
    communities: new Map(),
    modularity: 0,
    communityCount: 0,
    lastUpdate: Date.now(),
  });

  useEffect(() => {
    const client = new GraphologyClient(config);
    clientRef.current = client;

    const unsubscribe = client.subscribe((newState) => {
      setState({ ...newState });
    });

    return () => {
      unsubscribe();
      client.destroy();
    };
  }, [config.wsUrl]);

  const addNode = useCallback((node: GraphNode) => {
    clientRef.current?.addNode(node);
  }, []);

  const addEdge = useCallback((edge: GraphEdge) => {
    clientRef.current?.addEdge(edge);
  }, []);

  const runLouvain = useCallback(() => {
    clientRef.current?.runLouvain();
  }, []);

  const detectAnomalies = useCallback(() => {
    clientRef.current?.detectAnomalies();
  }, []);

  return {
    state,
    addNode,
    addEdge,
    runLouvain,
    detectAnomalies,
    client: clientRef.current,
  };
}

/**
 * React hook for community statistics
 */
export function useCommunityStats(state: GraphState) {
  return {
    communityCount: state.communityCount,
    modularity: state.modularity,
    nodeCount: state.nodes.size,
    edgeCount: state.edges.size,
    lastUpdate: state.lastUpdate,
  };
}
