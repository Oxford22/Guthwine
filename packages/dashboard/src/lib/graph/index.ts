/**
 * Client-Side Graph Intelligence Module
 * 
 * Provides real-time graph analysis with Web Worker-based Louvain.
 */

export {
  GraphologyClient,
  useGraphologyClient,
  useCommunityStats,
  type GraphNode,
  type GraphEdge,
  type GraphState,
  type GraphologyClientConfig,
  type CDCMessage,
  type CDCEvent,
} from './graphology-client.js';
