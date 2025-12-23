/**
 * Fraud Detection Service
 * 
 * Implements graph-based fraud detection using:
 * - Louvain Modularity for community detection
 * - Weakly Connected Components (WCC) for cluster analysis
 * - Anomaly scoring based on behavioral patterns
 * - Real-time fraud alerts
 * 
 * Based on VAGNN Architecture specification.
 */

import { Neo4jGraphService, AnomalyResult, CommunityResult } from './neo4j-service.js';

// Fraud Detection Types
export interface FraudAlert {
  id: string;
  type: FraudAlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  entityId: string;
  entityType: 'Agent' | 'Organization' | 'Transaction' | 'DelegationChain';
  description: string;
  score: number;
  evidence: FraudEvidence[];
  detectedAt: Date;
  status: 'new' | 'investigating' | 'confirmed' | 'dismissed';
  metadata: Record<string, unknown>;
}

export enum FraudAlertType {
  SYBIL_ATTACK = 'sybil_attack',
  CIRCULAR_DELEGATION = 'circular_delegation',
  VELOCITY_ANOMALY = 'velocity_anomaly',
  COMMUNITY_OUTLIER = 'community_outlier',
  COLLUSION_RING = 'collusion_ring',
  PRIVILEGE_ESCALATION = 'privilege_escalation',
  MONEY_LAUNDERING = 'money_laundering',
  ACCOUNT_TAKEOVER = 'account_takeover',
}

export interface FraudEvidence {
  type: string;
  description: string;
  data: Record<string, unknown>;
  weight: number;
}

export interface CommunityProfile {
  communityId: number;
  size: number;
  members: string[];
  avgRiskScore: number;
  totalTransactionVolume: number;
  avgTransactionFrequency: number;
  delegationDensity: number;
  centralityScore: number;
  isAnomalous: boolean;
  anomalyReasons: string[];
}

export interface AgentRiskProfile {
  agentId: string;
  communityId: number;
  riskScore: number;
  riskFactors: RiskFactor[];
  behaviorProfile: BehaviorProfile;
  relatedAlerts: string[];
}

export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
}

export interface BehaviorProfile {
  transactionFrequency: number;
  avgTransactionAmount: number;
  delegationCount: number;
  delegationDepth: number;
  uniqueCounterparties: number;
  activityHours: number[];
  geographicSpread: string[];
}

export interface FraudDetectionConfig {
  louvainResolution: number;
  wccMinSize: number;
  velocityThreshold: number;
  communityOutlierThreshold: number;
  sybilSimilarityThreshold: number;
  alertCooldownMs: number;
}

/**
 * Louvain Community Detection Algorithm
 * 
 * Detects communities by maximizing modularity:
 * Q = (1/2m) * Σ[A_ij - (k_i * k_j)/(2m)] * δ(c_i, c_j)
 */
export class LouvainDetector {
  private adjacencyList: Map<string, Set<string>> = new Map();
  private nodeWeights: Map<string, number> = new Map();
  private communities: Map<string, number> = new Map();
  private resolution: number;
  
  constructor(resolution: number = 1.0) {
    this.resolution = resolution;
  }
  
  /**
   * Add an edge to the graph
   */
  addEdge(from: string, to: string, weight: number = 1): void {
    if (!this.adjacencyList.has(from)) {
      this.adjacencyList.set(from, new Set());
    }
    if (!this.adjacencyList.has(to)) {
      this.adjacencyList.set(to, new Set());
    }
    
    this.adjacencyList.get(from)!.add(to);
    this.adjacencyList.get(to)!.add(from);
    
    this.nodeWeights.set(from, (this.nodeWeights.get(from) || 0) + weight);
    this.nodeWeights.set(to, (this.nodeWeights.get(to) || 0) + weight);
  }
  
  /**
   * Run Louvain algorithm
   */
  detect(): Map<string, number> {
    // Initialize: each node in its own community
    let communityId = 0;
    for (const node of this.adjacencyList.keys()) {
      this.communities.set(node, communityId++);
    }
    
    let improved = true;
    let iterations = 0;
    const maxIterations = 100;
    
    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;
      
      for (const node of this.adjacencyList.keys()) {
        const currentCommunity = this.communities.get(node)!;
        let bestCommunity = currentCommunity;
        let bestGain = 0;
        
        // Get neighboring communities
        const neighborCommunities = new Set<number>();
        const neighbors = this.adjacencyList.get(node) || new Set();
        
        for (const neighbor of neighbors) {
          neighborCommunities.add(this.communities.get(neighbor)!);
        }
        
        // Try moving to each neighboring community
        for (const targetCommunity of neighborCommunities) {
          if (targetCommunity === currentCommunity) continue;
          
          const gain = this.calculateModularityGain(node, currentCommunity, targetCommunity);
          
          if (gain > bestGain) {
            bestGain = gain;
            bestCommunity = targetCommunity;
          }
        }
        
        // Move node if beneficial
        if (bestCommunity !== currentCommunity) {
          this.communities.set(node, bestCommunity);
          improved = true;
        }
      }
    }
    
    // Renumber communities to be contiguous
    return this.renumberCommunities();
  }
  
  /**
   * Calculate modularity gain from moving a node
   */
  private calculateModularityGain(node: string, fromCommunity: number, toCommunity: number): number {
    const totalWeight = Array.from(this.nodeWeights.values()).reduce((a, b) => a + b, 0);
    const nodeWeight = this.nodeWeights.get(node) || 0;
    
    // Calculate connections to target community
    let toConnections = 0;
    let fromConnections = 0;
    const neighbors = this.adjacencyList.get(node) || new Set();
    
    for (const neighbor of neighbors) {
      const neighborCommunity = this.communities.get(neighbor)!;
      if (neighborCommunity === toCommunity) {
        toConnections++;
      }
      if (neighborCommunity === fromCommunity) {
        fromConnections++;
      }
    }
    
    // Simplified modularity gain calculation
    const gain = (toConnections - fromConnections) / totalWeight;
    return gain * this.resolution;
  }
  
  /**
   * Renumber communities to be contiguous (0, 1, 2, ...)
   */
  private renumberCommunities(): Map<string, number> {
    const communityMapping = new Map<number, number>();
    let newId = 0;
    
    const result = new Map<string, number>();
    
    for (const [node, community] of this.communities) {
      if (!communityMapping.has(community)) {
        communityMapping.set(community, newId++);
      }
      result.set(node, communityMapping.get(community)!);
    }
    
    return result;
  }
  
  /**
   * Get community statistics
   */
  getCommunityStats(): CommunityResult[] {
    const communities = this.detect();
    const communityMembers = new Map<number, string[]>();
    
    for (const [node, community] of communities) {
      if (!communityMembers.has(community)) {
        communityMembers.set(community, []);
      }
      communityMembers.get(community)!.push(node);
    }
    
    const results: CommunityResult[] = [];
    for (const [communityId, members] of communityMembers) {
      results.push({
        communityId,
        members,
        size: members.length,
        modularity: this.calculateCommunityModularity(communityId),
      });
    }
    
    return results.sort((a, b) => b.size - a.size);
  }
  
  /**
   * Calculate modularity for a specific community
   */
  private calculateCommunityModularity(communityId: number): number {
    const communities = this.communities;
    const members = Array.from(communities.entries())
      .filter(([_, c]) => c === communityId)
      .map(([n, _]) => n);
    
    if (members.length === 0) return 0;
    
    let internalEdges = 0;
    let totalDegree = 0;
    
    for (const member of members) {
      const neighbors = this.adjacencyList.get(member) || new Set();
      totalDegree += neighbors.size;
      
      for (const neighbor of neighbors) {
        if (communities.get(neighbor) === communityId) {
          internalEdges++;
        }
      }
    }
    
    // Each edge counted twice
    internalEdges /= 2;
    
    const totalEdges = Array.from(this.adjacencyList.values())
      .reduce((sum, neighbors) => sum + neighbors.size, 0) / 2;
    
    if (totalEdges === 0) return 0;
    
    return (internalEdges / totalEdges) - Math.pow(totalDegree / (2 * totalEdges), 2);
  }
}

/**
 * Weakly Connected Components Algorithm
 */
export class WCCDetector {
  private adjacencyList: Map<string, Set<string>> = new Map();
  
  /**
   * Add an edge to the graph
   */
  addEdge(from: string, to: string): void {
    if (!this.adjacencyList.has(from)) {
      this.adjacencyList.set(from, new Set());
    }
    if (!this.adjacencyList.has(to)) {
      this.adjacencyList.set(to, new Set());
    }
    
    this.adjacencyList.get(from)!.add(to);
    this.adjacencyList.get(to)!.add(from);
  }
  
  /**
   * Find all weakly connected components using BFS
   */
  findComponents(): Map<string, number> {
    const visited = new Set<string>();
    const components = new Map<string, number>();
    let componentId = 0;
    
    for (const node of this.adjacencyList.keys()) {
      if (!visited.has(node)) {
        // BFS to find all nodes in this component
        const queue = [node];
        visited.add(node);
        
        while (queue.length > 0) {
          const current = queue.shift()!;
          components.set(current, componentId);
          
          const neighbors = this.adjacencyList.get(current) || new Set();
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        
        componentId++;
      }
    }
    
    return components;
  }
  
  /**
   * Get component statistics
   */
  getComponentStats(): Array<{ componentId: number; members: string[]; size: number }> {
    const components = this.findComponents();
    const componentMembers = new Map<number, string[]>();
    
    for (const [node, component] of components) {
      if (!componentMembers.has(component)) {
        componentMembers.set(component, []);
      }
      componentMembers.get(component)!.push(node);
    }
    
    return Array.from(componentMembers.entries())
      .map(([componentId, members]) => ({
        componentId,
        members,
        size: members.length,
      }))
      .sort((a, b) => b.size - a.size);
  }
}

/**
 * Fraud Detection Service
 */
export class FraudDetectionService {
  private graphService: Neo4jGraphService;
  private config: FraudDetectionConfig;
  private alerts: Map<string, FraudAlert> = new Map();
  private alertCooldowns: Map<string, number> = new Map();
  
  constructor(graphService: Neo4jGraphService, config?: Partial<FraudDetectionConfig>) {
    this.graphService = graphService;
    this.config = {
      louvainResolution: config?.louvainResolution || 1.0,
      wccMinSize: config?.wccMinSize || 3,
      velocityThreshold: config?.velocityThreshold || 10,
      communityOutlierThreshold: config?.communityOutlierThreshold || 2.0,
      sybilSimilarityThreshold: config?.sybilSimilarityThreshold || 0.9,
      alertCooldownMs: config?.alertCooldownMs || 300000, // 5 minutes
    };
  }
  
  /**
   * Run comprehensive fraud detection
   */
  async runDetection(): Promise<FraudAlert[]> {
    const newAlerts: FraudAlert[] = [];
    
    // 1. Detect Sybil attacks using community analysis
    const sybilAlerts = await this.detectSybilAttacks();
    newAlerts.push(...sybilAlerts);
    
    // 2. Detect circular delegations
    const circularAlerts = await this.detectCircularDelegations();
    newAlerts.push(...circularAlerts);
    
    // 3. Detect velocity anomalies
    const velocityAlerts = await this.detectVelocityAnomalies();
    newAlerts.push(...velocityAlerts);
    
    // 4. Detect community outliers
    const outlierAlerts = await this.detectCommunityOutliers();
    newAlerts.push(...outlierAlerts);
    
    // 5. Detect collusion rings
    const collusionAlerts = await this.detectCollusionRings();
    newAlerts.push(...collusionAlerts);
    
    // Filter by cooldown and store
    const filteredAlerts = this.filterByCooldown(newAlerts);
    for (const alert of filteredAlerts) {
      this.alerts.set(alert.id, alert);
      this.alertCooldowns.set(this.getAlertKey(alert), Date.now());
    }
    
    return filteredAlerts;
  }
  
  /**
   * Detect Sybil attacks using community detection
   * 
   * Sybil attacks create many fake identities that cluster together
   * and have similar behavior patterns.
   */
  private async detectSybilAttacks(): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    
    // Build graph from delegation relationships
    const louvain = new LouvainDetector(this.config.louvainResolution);
    
    // In production, fetch edges from Neo4j
    // For now, use mock data
    const communities = louvain.getCommunityStats();
    
    for (const community of communities) {
      // Check for suspicious patterns
      if (community.size >= 5) {
        // Calculate behavioral similarity within community
        const similarity = await this.calculateBehavioralSimilarity(community.members);
        
        if (similarity > this.config.sybilSimilarityThreshold) {
          alerts.push({
            id: crypto.randomUUID(),
            type: FraudAlertType.SYBIL_ATTACK,
            severity: 'critical',
            entityId: `community-${community.communityId}`,
            entityType: 'Agent',
            description: `Potential Sybil attack detected: ${community.size} agents with ${(similarity * 100).toFixed(1)}% behavioral similarity`,
            score: similarity,
            evidence: [
              {
                type: 'community_analysis',
                description: 'High behavioral similarity within community',
                data: {
                  communityId: community.communityId,
                  size: community.size,
                  similarity,
                  members: community.members.slice(0, 10),
                },
                weight: 0.8,
              },
            ],
            detectedAt: new Date(),
            status: 'new',
            metadata: { communityId: community.communityId },
          });
        }
      }
    }
    
    return alerts;
  }
  
  /**
   * Detect circular delegation chains
   */
  private async detectCircularDelegations(): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    
    // Use Neo4j to find cycles
    const cycles = await this.graphService.detectCircularDelegations(3);
    
    for (const cycle of cycles) {
      alerts.push({
        id: crypto.randomUUID(),
        type: FraudAlertType.CIRCULAR_DELEGATION,
        severity: cycle.length > 5 ? 'critical' : 'high',
        entityId: cycle.nodes[0]?.id || 'unknown',
        entityType: 'DelegationChain',
        description: `Circular delegation chain detected with ${cycle.length} hops`,
        score: Math.min(1, cycle.length / 10),
        evidence: [
          {
            type: 'cycle_detection',
            description: 'Delegation chain forms a cycle',
            data: {
              length: cycle.length,
              nodes: cycle.nodes.map(n => n.id),
            },
            weight: 0.9,
          },
        ],
        detectedAt: new Date(),
        status: 'new',
        metadata: { cycleLength: cycle.length },
      });
    }
    
    return alerts;
  }
  
  /**
   * Detect velocity anomalies (rapid transactions)
   */
  private async detectVelocityAnomalies(): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    
    // Find agents with unusual transaction velocity
    const anomalies = await this.graphService.findHighRiskPatterns();
    
    for (const anomaly of anomalies) {
      if (anomaly.anomalyType === 'RAPID_TRANSACTIONS') {
        alerts.push({
          id: crypto.randomUUID(),
          type: FraudAlertType.VELOCITY_ANOMALY,
          severity: 'high',
          entityId: anomaly.entityId,
          entityType: 'Agent',
          description: `Unusual transaction velocity: ${anomaly.details.transactionCount} transactions in short period`,
          score: anomaly.score,
          evidence: [
            {
              type: 'velocity_analysis',
              description: 'Transaction frequency exceeds normal patterns',
              data: anomaly.details,
              weight: 0.7,
            },
          ],
          detectedAt: new Date(),
          status: 'new',
          metadata: anomaly.details,
        });
      }
    }
    
    return alerts;
  }
  
  /**
   * Detect community outliers
   */
  private async detectCommunityOutliers(): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    
    // Build WCC graph
    const wcc = new WCCDetector();
    
    // In production, fetch edges from Neo4j
    const components = wcc.getComponentStats();
    
    // Find small isolated components (potential fraud rings)
    for (const component of components) {
      if (component.size >= this.config.wccMinSize && component.size <= 10) {
        // Small isolated clusters are suspicious
        const avgRiskScore = await this.calculateAvgRiskScore(component.members);
        
        if (avgRiskScore > 0.5) {
          alerts.push({
            id: crypto.randomUUID(),
            type: FraudAlertType.COMMUNITY_OUTLIER,
            severity: 'medium',
            entityId: `component-${component.componentId}`,
            entityType: 'Agent',
            description: `Isolated cluster of ${component.size} agents with elevated risk`,
            score: avgRiskScore,
            evidence: [
              {
                type: 'isolation_analysis',
                description: 'Small isolated cluster with high risk scores',
                data: {
                  componentId: component.componentId,
                  size: component.size,
                  avgRiskScore,
                  members: component.members,
                },
                weight: 0.6,
              },
            ],
            detectedAt: new Date(),
            status: 'new',
            metadata: { componentId: component.componentId },
          });
        }
      }
    }
    
    return alerts;
  }
  
  /**
   * Detect collusion rings
   */
  private async detectCollusionRings(): Promise<FraudAlert[]> {
    const alerts: FraudAlert[] = [];
    
    // Look for tightly connected groups with mutual delegations
    // and coordinated transaction patterns
    
    // In production, this would use more sophisticated graph algorithms
    // like triangle counting and motif detection
    
    return alerts;
  }
  
  /**
   * Calculate behavioral similarity within a group
   */
  private async calculateBehavioralSimilarity(members: string[]): Promise<number> {
    if (members.length < 2) return 0;
    
    // In production, compare:
    // - Transaction patterns (amounts, frequencies, times)
    // - Delegation patterns
    // - API usage patterns
    // - Geographic patterns
    
    // Simplified: return mock similarity
    return 0.3 + Math.random() * 0.4;
  }
  
  /**
   * Calculate average risk score for a group
   */
  private async calculateAvgRiskScore(members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    
    // In production, fetch from database
    return 0.2 + Math.random() * 0.5;
  }
  
  /**
   * Filter alerts by cooldown period
   */
  private filterByCooldown(alerts: FraudAlert[]): FraudAlert[] {
    const now = Date.now();
    
    return alerts.filter(alert => {
      const key = this.getAlertKey(alert);
      const lastAlert = this.alertCooldowns.get(key);
      
      if (!lastAlert) return true;
      return now - lastAlert > this.config.alertCooldownMs;
    });
  }
  
  /**
   * Get unique key for alert deduplication
   */
  private getAlertKey(alert: FraudAlert): string {
    return `${alert.type}:${alert.entityId}`;
  }
  
  /**
   * Get all active alerts
   */
  getAlerts(status?: FraudAlert['status']): FraudAlert[] {
    const alerts = Array.from(this.alerts.values());
    if (status) {
      return alerts.filter(a => a.status === status);
    }
    return alerts;
  }
  
  /**
   * Update alert status
   */
  updateAlertStatus(alertId: string, status: FraudAlert['status']): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.status = status;
      return true;
    }
    return false;
  }
  
  /**
   * Get agent risk profile
   */
  async getAgentRiskProfile(agentId: string): Promise<AgentRiskProfile | null> {
    // Build comprehensive risk profile
    const riskFactors: RiskFactor[] = [];
    
    // Factor 1: Transaction velocity
    const txHistory = await this.graphService.getAgentTransactionHistory(agentId, 100);
    if (txHistory.length > 50) {
      riskFactors.push({
        name: 'high_transaction_volume',
        score: Math.min(1, txHistory.length / 100),
        weight: 0.3,
        description: 'High transaction volume',
      });
    }
    
    // Factor 2: Delegation depth
    // In production, calculate from graph
    
    // Factor 3: Community membership
    // In production, check if in suspicious community
    
    const totalScore = riskFactors.reduce(
      (sum, f) => sum + f.score * f.weight,
      0
    ) / Math.max(1, riskFactors.reduce((sum, f) => sum + f.weight, 0));
    
    return {
      agentId,
      communityId: 0, // Would be calculated
      riskScore: totalScore,
      riskFactors,
      behaviorProfile: {
        transactionFrequency: txHistory.length,
        avgTransactionAmount: txHistory.reduce((sum, t) => sum + t.amount, 0) / Math.max(1, txHistory.length),
        delegationCount: 0,
        delegationDepth: 0,
        uniqueCounterparties: 0,
        activityHours: [],
        geographicSpread: [],
      },
      relatedAlerts: Array.from(this.alerts.values())
        .filter(a => a.entityId === agentId)
        .map(a => a.id),
    };
  }
  
  /**
   * Export detection results for analysis
   */
  exportResults(): {
    alerts: FraudAlert[];
    statistics: {
      totalAlerts: number;
      bySeverity: Record<string, number>;
      byType: Record<string, number>;
      byStatus: Record<string, number>;
    };
  } {
    const alerts = Array.from(this.alerts.values());
    
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    
    for (const alert of alerts) {
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
      byType[alert.type] = (byType[alert.type] || 0) + 1;
      byStatus[alert.status] = (byStatus[alert.status] || 0) + 1;
    }
    
    return {
      alerts,
      statistics: {
        totalAlerts: alerts.length,
        bySeverity,
        byType,
        byStatus,
      },
    };
  }
}

// Helper function to generate UUID (for environments without crypto.randomUUID)
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Polyfill for crypto.randomUUID if not available
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  (crypto as { randomUUID: () => string }).randomUUID = generateUUID;
}

export default FraudDetectionService;
