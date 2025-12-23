/**
 * Guthwine - Louvain Community Detection Web Worker
 * 
 * Runs the Louvain Modularity algorithm in a dedicated Web Worker
 * to avoid blocking the main UI thread. This enables real-time
 * community detection on large graphs without performance degradation.
 * 
 * Algorithm: Louvain Modularity Optimization
 * - Phase 1: Local modularity optimization
 * - Phase 2: Community aggregation
 * - Repeat until no improvement
 * 
 * Time Complexity: O(n log n) on sparse graphs
 */

// Graph data structures
interface GraphNode {
  id: string;
  attributes: Record<string, unknown>;
  community?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface LouvainResult {
  communities: Map<string, number>;
  modularity: number;
  iterations: number;
  communityCount: number;
  communityStats: CommunityStats[];
}

interface CommunityStats {
  id: number;
  size: number;
  density: number;
  nodes: string[];
}

// Worker message types
interface WorkerMessage {
  action: 'optimize' | 'getStats' | 'detectAnomalies';
  topology?: GraphData;
  options?: LouvainOptions;
}

interface LouvainOptions {
  resolution?: number;
  maxIterations?: number;
  minModularityGain?: number;
}

/**
 * Louvain Algorithm Implementation
 */
class LouvainAlgorithm {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private adjacency: Map<string, Map<string, number>> = new Map();
  private communities: Map<string, number> = new Map();
  private communityWeights: Map<number, number> = new Map();
  private nodeWeights: Map<string, number> = new Map();
  private totalWeight: number = 0;
  private resolution: number = 1.0;

  constructor(graph: GraphData, options: LouvainOptions = {}) {
    this.resolution = options.resolution || 1.0;
    this.initializeGraph(graph);
  }

  /**
   * Initialize internal graph representation
   */
  private initializeGraph(graph: GraphData): void {
    // Add nodes
    for (const node of graph.nodes) {
      this.nodes.set(node.id, node);
      this.adjacency.set(node.id, new Map());
      this.nodeWeights.set(node.id, 0);
      // Initially, each node is its own community
      this.communities.set(node.id, this.communities.size);
    }

    // Add edges (undirected)
    for (const edge of graph.edges) {
      const weight = edge.weight || 1;
      this.edges.push(edge);
      this.totalWeight += weight;

      // Update adjacency
      const sourceAdj = this.adjacency.get(edge.source)!;
      const targetAdj = this.adjacency.get(edge.target)!;
      
      sourceAdj.set(edge.target, (sourceAdj.get(edge.target) || 0) + weight);
      targetAdj.set(edge.source, (targetAdj.get(edge.source) || 0) + weight);

      // Update node weights (degree)
      this.nodeWeights.set(edge.source, (this.nodeWeights.get(edge.source) || 0) + weight);
      this.nodeWeights.set(edge.target, (this.nodeWeights.get(edge.target) || 0) + weight);
    }

    // Initialize community weights
    this.updateCommunityWeights();
  }

  /**
   * Update community weight sums
   */
  private updateCommunityWeights(): void {
    this.communityWeights.clear();
    for (const [nodeId, community] of this.communities) {
      const weight = this.nodeWeights.get(nodeId) || 0;
      this.communityWeights.set(
        community,
        (this.communityWeights.get(community) || 0) + weight
      );
    }
  }

  /**
   * Calculate modularity gain for moving a node to a new community
   */
  private calculateModularityGain(
    nodeId: string,
    targetCommunity: number
  ): number {
    const currentCommunity = this.communities.get(nodeId)!;
    if (currentCommunity === targetCommunity) return 0;

    const ki = this.nodeWeights.get(nodeId) || 0;
    const m2 = this.totalWeight * 2;

    // Sum of weights to target community
    let sumIn = 0;
    const neighbors = this.adjacency.get(nodeId)!;
    for (const [neighbor, weight] of neighbors) {
      if (this.communities.get(neighbor) === targetCommunity) {
        sumIn += weight;
      }
    }

    // Community weight sum
    const sigmaTarget = this.communityWeights.get(targetCommunity) || 0;

    // Modularity gain formula
    const gain = (sumIn / m2) - (this.resolution * ki * sigmaTarget) / (m2 * m2);
    
    return gain * 2; // Factor of 2 for undirected
  }

  /**
   * Run one iteration of local modularity optimization
   */
  private localOptimization(minGain: number): boolean {
    let improved = false;
    const nodeIds = Array.from(this.nodes.keys());
    
    // Shuffle for randomization
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j]!, nodeIds[i]!];
    }

    for (const nodeId of nodeIds) {
      const currentCommunity = this.communities.get(nodeId)!;
      let bestCommunity = currentCommunity;
      let bestGain = 0;

      // Find neighboring communities
      const neighborCommunities = new Set<number>();
      const neighbors = this.adjacency.get(nodeId)!;
      for (const [neighbor] of neighbors) {
        neighborCommunities.add(this.communities.get(neighbor)!);
      }

      // Evaluate each neighboring community
      for (const community of neighborCommunities) {
        const gain = this.calculateModularityGain(nodeId, community);
        if (gain > bestGain + minGain) {
          bestGain = gain;
          bestCommunity = community;
        }
      }

      // Move node if beneficial
      if (bestCommunity !== currentCommunity) {
        // Update community weights
        const nodeWeight = this.nodeWeights.get(nodeId) || 0;
        this.communityWeights.set(
          currentCommunity,
          (this.communityWeights.get(currentCommunity) || 0) - nodeWeight
        );
        this.communityWeights.set(
          bestCommunity,
          (this.communityWeights.get(bestCommunity) || 0) + nodeWeight
        );

        this.communities.set(nodeId, bestCommunity);
        improved = true;
      }
    }

    return improved;
  }

  /**
   * Calculate current modularity score
   */
  calculateModularity(): number {
    let Q = 0;
    const m2 = this.totalWeight * 2;

    for (const edge of this.edges) {
      const ci = this.communities.get(edge.source)!;
      const cj = this.communities.get(edge.target)!;
      
      if (ci === cj) {
        const ki = this.nodeWeights.get(edge.source) || 0;
        const kj = this.nodeWeights.get(edge.target) || 0;
        Q += edge.weight - (this.resolution * ki * kj) / m2;
      }
    }

    return Q / m2;
  }

  /**
   * Run the full Louvain algorithm
   */
  run(options: LouvainOptions = {}): LouvainResult {
    const maxIterations = options.maxIterations || 100;
    const minGain = options.minModularityGain || 1e-6;
    
    let iterations = 0;
    let improved = true;

    while (improved && iterations < maxIterations) {
      improved = this.localOptimization(minGain);
      iterations++;
    }

    // Renumber communities to be contiguous
    const communityMap = new Map<number, number>();
    let nextCommunity = 0;
    
    for (const [nodeId, community] of this.communities) {
      if (!communityMap.has(community)) {
        communityMap.set(community, nextCommunity++);
      }
      this.communities.set(nodeId, communityMap.get(community)!);
    }

    // Calculate statistics
    const stats = this.calculateCommunityStats();

    return {
      communities: new Map(this.communities),
      modularity: this.calculateModularity(),
      iterations,
      communityCount: nextCommunity,
      communityStats: stats,
    };
  }

  /**
   * Calculate statistics for each community
   */
  private calculateCommunityStats(): CommunityStats[] {
    const stats = new Map<number, CommunityStats>();

    // Group nodes by community
    for (const [nodeId, community] of this.communities) {
      if (!stats.has(community)) {
        stats.set(community, {
          id: community,
          size: 0,
          density: 0,
          nodes: [],
        });
      }
      const s = stats.get(community)!;
      s.size++;
      s.nodes.push(nodeId);
    }

    // Calculate density for each community
    for (const [community, s] of stats) {
      if (s.size > 1) {
        let internalEdges = 0;
        const nodeSet = new Set(s.nodes);
        
        for (const edge of this.edges) {
          if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
            internalEdges++;
          }
        }
        
        const maxEdges = (s.size * (s.size - 1)) / 2;
        s.density = maxEdges > 0 ? internalEdges / maxEdges : 0;
      }
    }

    return Array.from(stats.values()).sort((a, b) => b.size - a.size);
  }

  getCommunities(): Map<string, number> {
    return this.communities;
  }
}

/**
 * Anomaly Detection using community structure
 */
function detectAnomalies(
  graph: GraphData,
  communities: Map<string, number>
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = [];
  
  // Build community membership
  const communityNodes = new Map<number, Set<string>>();
  for (const [nodeId, community] of communities) {
    if (!communityNodes.has(community)) {
      communityNodes.set(community, new Set());
    }
    communityNodes.get(community)!.add(nodeId);
  }

  // Build adjacency for quick lookup
  const adjacency = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  // Detect bridge nodes (high inter-community connections)
  for (const node of graph.nodes) {
    const nodeCommunity = communities.get(node.id);
    if (nodeCommunity === undefined) continue;

    const neighbors = adjacency.get(node.id) || new Set();
    let intraCommunity = 0;
    let interCommunity = 0;

    for (const neighbor of neighbors) {
      const neighborCommunity = communities.get(neighbor);
      if (neighborCommunity === nodeCommunity) {
        intraCommunity++;
      } else {
        interCommunity++;
      }
    }

    // Flag nodes with unusually high inter-community connections
    const total = intraCommunity + interCommunity;
    if (total > 0 && interCommunity / total > 0.7) {
      anomalies.push({
        nodeId: node.id,
        type: 'bridge_node',
        score: interCommunity / total,
        description: `Node has ${interCommunity}/${total} connections outside its community`,
      });
    }
  }

  // Detect isolated nodes within communities
  for (const [community, nodes] of communityNodes) {
    if (nodes.size < 3) continue;

    for (const nodeId of nodes) {
      const neighbors = adjacency.get(nodeId) || new Set();
      let communityNeighbors = 0;
      
      for (const neighbor of neighbors) {
        if (nodes.has(neighbor)) {
          communityNeighbors++;
        }
      }

      // Flag nodes with very few intra-community connections
      if (communityNeighbors === 0 && nodes.size > 1) {
        anomalies.push({
          nodeId,
          type: 'isolated_in_community',
          score: 1.0,
          description: `Node has no connections within its community of ${nodes.size} nodes`,
        });
      }
    }
  }

  return anomalies;
}

interface AnomalyResult {
  nodeId: string;
  type: 'bridge_node' | 'isolated_in_community' | 'outlier';
  score: number;
  description: string;
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { action, topology, options } = event.data;

  try {
    switch (action) {
      case 'optimize': {
        if (!topology) {
          throw new Error('No topology provided');
        }

        const algorithm = new LouvainAlgorithm(topology, options);
        const result = algorithm.run(options);

        // Convert Map to object for postMessage
        const communitiesObj: Record<string, number> = {};
        for (const [key, value] of result.communities) {
          communitiesObj[key] = value;
        }

        self.postMessage({
          action: 'result',
          success: true,
          data: {
            communities: communitiesObj,
            modularity: result.modularity,
            iterations: result.iterations,
            communityCount: result.communityCount,
            communityStats: result.communityStats,
          },
        });
        break;
      }

      case 'detectAnomalies': {
        if (!topology) {
          throw new Error('No topology provided');
        }

        const algorithm = new LouvainAlgorithm(topology, options);
        const result = algorithm.run(options);
        const anomalies = detectAnomalies(topology, result.communities);

        self.postMessage({
          action: 'anomalies',
          success: true,
          data: {
            anomalies,
            communityCount: result.communityCount,
          },
        });
        break;
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    self.postMessage({
      action: 'error',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Signal ready
self.postMessage({ action: 'ready' });
