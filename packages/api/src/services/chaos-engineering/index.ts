/**
 * Chaos Engineering Module
 * 
 * Controlled fault injection for resilience testing
 */

export {
  ChaosEngineeringService,
  ChaosExperimentType,
  NetworkPartitionInjector,
  LatencyInjector,
  ResourceExhaustionInjector,
  ServiceDegradationInjector,
  DatabaseFailureInjector,
} from './chaos-service.js';

export type {
  ChaosExperiment,
  ChaosConfig,
  ChaosResult,
  ChaosMetrics,
  ImpactAssessment,
  SafetyCheck,
  FaultInjector,
} from './chaos-service.js';
