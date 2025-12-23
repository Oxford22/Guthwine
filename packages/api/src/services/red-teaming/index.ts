/**
 * Red Teaming Module
 * 
 * Automated adversarial testing for AI agent security
 */

export {
  RedTeamEngine,
  SandwichDefense,
  PerplexityFilter,
  CanarySystem,
  PayloadMutator,
  ATTACK_LIBRARY,
  AttackCategory,
} from './red-team-engine.js';

export type {
  AttackPayload,
  TestResult,
  DetectedIssue,
  RedTeamConfig,
} from './red-team-engine.js';
