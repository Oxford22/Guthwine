/**
 * Advanced Merkle Tree Module
 * 
 * Implements Cartesian Merkle Tree for deterministic structure
 * and efficient non-membership proofs.
 */

export { CartesianMerkleTree } from './cartesian-merkle.js';

export type {
  TreeNode,
  MembershipProof,
  NonMembershipProof,
  ProofStep,
  BatchUpdate,
  SerializedTree,
} from './cartesian-merkle.js';
