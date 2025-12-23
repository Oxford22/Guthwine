/**
 * Verifiable Secret Sharing (VSS) Module
 * 
 * Implements Feldman's VSS for secure key sharding and recovery.
 */

export {
  FeldmanVSS,
  DistributedKeyGeneration,
  PRIME,
  GENERATOR,
  modPow,
  modInverse,
  randomBigInt,
} from './feldman-vss.js';

export type {
  Share,
  Commitment,
  VSSResult,
  ShareVerification,
} from './feldman-vss.js';

export {
  KeyRecoveryService,
  EmergencyOverrideManager,
} from './key-recovery.js';

export type {
  KeyShard,
  KeyRecoveryConfig,
  CustodianInfo,
  RecoveryAttempt,
  ShardSubmission,
} from './key-recovery.js';
