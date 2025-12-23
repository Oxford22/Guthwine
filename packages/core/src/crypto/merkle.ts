/**
 * Guthwine - Merkle Tree Implementation
 * For tamper-evident audit log verification
 */

import { hash } from './keys.js';

/**
 * Merkle tree node
 */
export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
  data?: string;
  index?: number;
}

/**
 * Merkle proof for a single leaf
 */
export interface MerkleProof {
  leaf: string;
  leafIndex: number;
  siblings: Array<{
    hash: string;
    position: 'left' | 'right';
  }>;
  root: string;
}

/**
 * Build a Merkle tree from an array of data
 */
export function buildMerkleTree(data: string[]): MerkleNode | null {
  if (data.length === 0) {
    return null;
  }

  // Create leaf nodes
  let nodes: MerkleNode[] = data.map((d, index) => ({
    hash: hash(d),
    data: d,
    index,
  }));

  // Build tree bottom-up
  while (nodes.length > 1) {
    const newLevel: MerkleNode[] = [];

    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i]!;
      const right = nodes[i + 1] || left; // Duplicate last node if odd

      const parentHash = hash(left.hash + right.hash);
      newLevel.push({
        hash: parentHash,
        left,
        right: nodes[i + 1] ? right : undefined,
      });
    }

    nodes = newLevel;
  }

  return nodes[0] || null;
}

/**
 * Get the Merkle root hash
 */
export function getMerkleRoot(data: string[]): string {
  const tree = buildMerkleTree(data);
  return tree?.hash || '';
}

/**
 * Generate a Merkle proof for a specific leaf
 */
export function generateMerkleProof(
  data: string[],
  leafIndex: number
): MerkleProof | null {
  if (leafIndex < 0 || leafIndex >= data.length) {
    return null;
  }

  const leafHash = hash(data[leafIndex]!);
  const siblings: MerkleProof['siblings'] = [];

  // Create leaf hashes
  let currentLevel = data.map(d => hash(d));
  let currentIndex = leafIndex;

  // Build proof by traversing up the tree
  while (currentLevel.length > 1) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    
    if (siblingIndex < currentLevel.length) {
      siblings.push({
        hash: currentLevel[siblingIndex]!,
        position: currentIndex % 2 === 0 ? 'right' : 'left',
      });
    } else {
      // Odd number of nodes, duplicate the last one
      siblings.push({
        hash: currentLevel[currentIndex]!,
        position: 'right',
      });
    }

    // Build next level
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i]!;
      const right = currentLevel[i + 1] || left;
      nextLevel.push(hash(left + right));
    }

    currentLevel = nextLevel;
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: leafHash,
    leafIndex,
    siblings,
    root: currentLevel[0] || '',
  };
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = proof.leaf;

  for (const sibling of proof.siblings) {
    if (sibling.position === 'left') {
      currentHash = hash(sibling.hash + currentHash);
    } else {
      currentHash = hash(currentHash + sibling.hash);
    }
  }

  return currentHash === proof.root;
}

/**
 * Verify data against a known Merkle root
 */
export function verifyDataAgainstRoot(
  data: string[],
  expectedRoot: string
): boolean {
  const computedRoot = getMerkleRoot(data);
  return computedRoot === expectedRoot;
}

/**
 * Audit chain entry for linked hashing
 */
export interface AuditChainEntry {
  sequenceNumber: number;
  data: string;
  previousHash: string | null;
  entryHash: string;
}

/**
 * Create a linked hash for an audit entry
 */
export function createAuditEntryHash(
  data: string,
  previousHash: string | null
): string {
  const content = previousHash ? `${previousHash}:${data}` : data;
  return hash(content);
}

/**
 * Verify an audit chain
 */
export function verifyAuditChain(
  entries: AuditChainEntry[]
): {
  valid: boolean;
  errors: Array<{
    sequenceNumber: number;
    error: string;
  }>;
} {
  const errors: Array<{ sequenceNumber: number; error: string }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    
    // Verify sequence
    if (i > 0 && entry.sequenceNumber !== entries[i - 1]!.sequenceNumber + 1) {
      errors.push({
        sequenceNumber: entry.sequenceNumber,
        error: `Sequence gap: expected ${entries[i - 1]!.sequenceNumber + 1}, got ${entry.sequenceNumber}`,
      });
    }

    // Verify previous hash link
    const expectedPreviousHash = i > 0 ? entries[i - 1]!.entryHash : null;
    if (entry.previousHash !== expectedPreviousHash) {
      errors.push({
        sequenceNumber: entry.sequenceNumber,
        error: `Previous hash mismatch: expected ${expectedPreviousHash}, got ${entry.previousHash}`,
      });
    }

    // Verify entry hash
    const computedHash = createAuditEntryHash(entry.data, entry.previousHash);
    if (entry.entryHash !== computedHash) {
      errors.push({
        sequenceNumber: entry.sequenceNumber,
        error: `Entry hash mismatch: expected ${computedHash}, got ${entry.entryHash}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build a Merkle root from audit entries
 */
export function buildAuditMerkleRoot(entries: AuditChainEntry[]): string {
  const hashes = entries.map(e => e.entryHash);
  return getMerkleRoot(hashes);
}

/**
 * Generate a Merkle proof for an audit entry
 */
export function generateAuditMerkleProof(
  entries: AuditChainEntry[],
  sequenceNumber: number
): MerkleProof | null {
  const index = entries.findIndex(e => e.sequenceNumber === sequenceNumber);
  if (index === -1) {
    return null;
  }

  const hashes = entries.map(e => e.entryHash);
  
  // We need to regenerate the proof using the hashes directly
  const proof = generateMerkleProof(hashes, index);
  if (!proof) {
    return null;
  }

  // Update the leaf to be the actual entry hash
  return {
    ...proof,
    leaf: entries[index]!.entryHash,
  };
}
