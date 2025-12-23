/**
 * Zero-Knowledge Proof Module
 * 
 * Implements ZK foundations for Guthwine:
 * - Circom circuit definitions
 * - SnarkJS proof generation/verification
 * - Batch ECDSA verification
 * - Recursive proof composition
 * 
 * Based on VAGNN Architecture specification.
 */

// SnarkJS Service
export { SnarkJSService, CIRCUITS } from './proofs/snarkjs-service.js';

export type {
  ZKProof,
  VerificationKey,
  CircuitInput,
  ProofResult,
  VerificationResult,
  CircuitDefinition,
} from './proofs/snarkjs-service.js';

// Circom Circuit Templates
export {
  MERKLE_MEMBERSHIP_CIRCUIT,
  MERKLE_NON_MEMBERSHIP_CIRCUIT,
  DELEGATION_CHAIN_CIRCUIT,
  BATCH_ECDSA_CIRCUIT,
  TRANSACTION_VALIDITY_CIRCUIT,
  RECURSIVE_COMPOSITION_CIRCUIT,
  generateCircomFile,
  getAllCircuitTemplates,
} from './circuits/templates.js';

export type { CircomTemplate } from './circuits/templates.js';
