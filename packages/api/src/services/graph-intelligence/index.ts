/**
 * Graph Intelligence Module
 * 
 * Neo4j-based graph analytics for fraud detection and pattern analysis
 */

export { Neo4jGraphService } from './neo4j-service.js';

export type {
  Neo4jDriver,
  Neo4jSession,
  Neo4jResult,
  Neo4jRecord,
  GraphAgent,
  GraphDelegation,
  GraphTransaction,
  GraphOrganization,
  CDCEvent,
  CDCConfig,
  PathResult,
  CommunityResult,
  AnomalyResult,
} from './neo4j-service.js';

// Fraud Detection
export {
  FraudDetectionService,
  LouvainDetector,
  WCCDetector,
  FraudAlertType,
} from './fraud-detection.js';

export type {
  FraudAlert,
  FraudEvidence,
  CommunityProfile,
  AgentRiskProfile,
  RiskFactor,
  BehaviorProfile,
  FraudDetectionConfig,
} from './fraud-detection.js';
