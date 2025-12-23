/**
 * Circom Circuit Templates
 * 
 * TypeScript representations of Circom circuits for code generation
 * and documentation. These templates can be compiled to actual .circom files.
 * 
 * Based on VAGNN Architecture specification.
 */

// Circom template interface
export interface CircomTemplate {
  name: string;
  description: string;
  pragma: string;
  includes: string[];
  template: string;
  mainComponent: string;
}

/**
 * Merkle Tree Membership Proof Circuit
 * 
 * Proves that a leaf exists in a Merkle tree at a specific position
 * without revealing the leaf value.
 */
export const MERKLE_MEMBERSHIP_CIRCUIT: CircomTemplate = {
  name: 'MerkleMembership',
  description: 'Proves membership in a Merkle tree',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/poseidon.circom',
    'circomlib/circuits/bitify.circom',
    'circomlib/circuits/mux1.circom',
  ],
  template: `
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    signal output isValid;
    
    component hashers[levels];
    component mux[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        hashers[i] = Poseidon(2);
        mux[i] = MultiMux1(2);
        
        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== levelHashes[i];
        mux[i].s <== pathIndices[i];
        
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        
        levelHashes[i + 1] <== hashers[i].out;
    }
    
    isValid <== levelHashes[levels] === root ? 1 : 0;
}
`,
  mainComponent: 'component main {public [root]} = MerkleTreeChecker(20);',
};

/**
 * Merkle Tree Non-Membership Proof Circuit
 * 
 * Proves that a key does NOT exist in a Merkle tree by showing
 * the adjacent keys that would bound it.
 */
export const MERKLE_NON_MEMBERSHIP_CIRCUIT: CircomTemplate = {
  name: 'MerkleNonMembership',
  description: 'Proves non-membership in a Merkle tree',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/poseidon.circom',
    'circomlib/circuits/comparators.circom',
    'circomlib/circuits/bitify.circom',
  ],
  template: `
template MerkleNonMembership(levels) {
    signal input root;
    signal input key;
    signal input leftBoundaryKey;
    signal input leftBoundaryValue;
    signal input rightBoundaryKey;
    signal input rightBoundaryValue;
    signal input leftPath[levels];
    signal input leftIndices[levels];
    signal input rightPath[levels];
    signal input rightIndices[levels];
    
    signal output isValid;
    
    // Verify left boundary < key
    component ltLeft = LessThan(252);
    ltLeft.in[0] <== leftBoundaryKey;
    ltLeft.in[1] <== key;
    
    // Verify key < right boundary
    component ltRight = LessThan(252);
    ltRight.in[0] <== key;
    ltRight.in[1] <== rightBoundaryKey;
    
    // Verify left boundary is in tree
    component leftChecker = MerkleTreeChecker(levels);
    leftChecker.leaf <== Poseidon(2)([leftBoundaryKey, leftBoundaryValue]);
    leftChecker.root <== root;
    for (var i = 0; i < levels; i++) {
        leftChecker.pathElements[i] <== leftPath[i];
        leftChecker.pathIndices[i] <== leftIndices[i];
    }
    
    // Verify right boundary is in tree
    component rightChecker = MerkleTreeChecker(levels);
    rightChecker.leaf <== Poseidon(2)([rightBoundaryKey, rightBoundaryValue]);
    rightChecker.root <== root;
    for (var i = 0; i < levels; i++) {
        rightChecker.pathElements[i] <== rightPath[i];
        rightChecker.pathIndices[i] <== rightIndices[i];
    }
    
    // All conditions must be true
    isValid <== ltLeft.out * ltRight.out * leftChecker.isValid * rightChecker.isValid;
}
`,
  mainComponent: 'component main {public [root, key]} = MerkleNonMembership(20);',
};

/**
 * Delegation Chain Verification Circuit
 * 
 * Proves that a valid delegation chain exists from a root agent
 * to a leaf agent, with all signatures valid.
 */
export const DELEGATION_CHAIN_CIRCUIT: CircomTemplate = {
  name: 'DelegationChain',
  description: 'Proves valid delegation chain from root to leaf',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/poseidon.circom',
    'circomlib/circuits/eddsa.circom',
  ],
  template: `
template DelegationChainVerifier(maxDepth) {
    signal input rootAgentId;
    signal input leafAgentId;
    signal input chainLength;
    signal input agentIds[maxDepth + 1];
    signal input delegationHashes[maxDepth];
    signal input signatures[maxDepth][64]; // EdDSA signatures
    signal input publicKeys[maxDepth][2];  // EdDSA public keys
    
    signal output isValid;
    
    // Verify chain starts with root and ends with leaf
    signal rootMatch;
    rootMatch <== agentIds[0] === rootAgentId ? 1 : 0;
    
    // Verify each delegation in chain
    component sigVerifiers[maxDepth];
    signal delegationValid[maxDepth];
    
    for (var i = 0; i < maxDepth; i++) {
        sigVerifiers[i] = EdDSAVerifier();
        
        // Message is hash of (from, to, delegationHash)
        sigVerifiers[i].msg <== Poseidon(3)([agentIds[i], agentIds[i+1], delegationHashes[i]]);
        sigVerifiers[i].A[0] <== publicKeys[i][0];
        sigVerifiers[i].A[1] <== publicKeys[i][1];
        sigVerifiers[i].R8[0] <== signatures[i][0];
        sigVerifiers[i].R8[1] <== signatures[i][1];
        sigVerifiers[i].S <== signatures[i][2];
        
        // Only validate if within chain length
        delegationValid[i] <== i < chainLength ? sigVerifiers[i].out : 1;
    }
    
    // Verify leaf matches
    signal leafMatch;
    leafMatch <== agentIds[chainLength] === leafAgentId ? 1 : 0;
    
    // All validations must pass
    signal allDelegationsValid;
    allDelegationsValid <== delegationValid[0];
    for (var i = 1; i < maxDepth; i++) {
        allDelegationsValid <== allDelegationsValid * delegationValid[i];
    }
    
    isValid <== rootMatch * leafMatch * allDelegationsValid;
}
`,
  mainComponent: 'component main {public [rootAgentId, leafAgentId]} = DelegationChainVerifier(10);',
};

/**
 * Batch ECDSA Verification Circuit
 * 
 * Verifies multiple ECDSA signatures in a single proof,
 * significantly reducing on-chain verification costs.
 */
export const BATCH_ECDSA_CIRCUIT: CircomTemplate = {
  name: 'BatchECDSA',
  description: 'Batch verification of ECDSA signatures',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/ecdsa.circom',
    'circomlib/circuits/poseidon.circom',
  ],
  template: `
template BatchECDSAVerifier(batchSize) {
    signal input messages[batchSize];
    signal input r[batchSize];
    signal input s[batchSize];
    signal input pubKeyX[batchSize];
    signal input pubKeyY[batchSize];
    
    signal output allValid;
    signal output batchHash;
    
    component verifiers[batchSize];
    signal sigValid[batchSize];
    
    for (var i = 0; i < batchSize; i++) {
        verifiers[i] = ECDSAVerify();
        verifiers[i].msg <== messages[i];
        verifiers[i].r <== r[i];
        verifiers[i].s <== s[i];
        verifiers[i].pubKeyX <== pubKeyX[i];
        verifiers[i].pubKeyY <== pubKeyY[i];
        
        sigValid[i] <== verifiers[i].valid;
    }
    
    // All signatures must be valid
    allValid <== sigValid[0];
    for (var i = 1; i < batchSize; i++) {
        allValid <== allValid * sigValid[i];
    }
    
    // Compute batch hash for reference
    component batchHasher = Poseidon(batchSize);
    for (var i = 0; i < batchSize; i++) {
        batchHasher.inputs[i] <== messages[i];
    }
    batchHash <== batchHasher.out;
}
`,
  mainComponent: 'component main {public [messages]} = BatchECDSAVerifier(10);',
};

/**
 * Transaction Validity Circuit
 * 
 * Proves that a transaction meets policy constraints
 * without revealing the actual amount.
 */
export const TRANSACTION_VALIDITY_CIRCUIT: CircomTemplate = {
  name: 'TransactionValidity',
  description: 'Proves transaction meets policy constraints',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/poseidon.circom',
    'circomlib/circuits/comparators.circom',
  ],
  template: `
template TransactionValidity() {
    signal input transactionHash;
    signal input amount;
    signal input maxAmount;
    signal input agentId;
    signal input policyHash;
    signal input agentBalance;
    signal input nonce;
    
    signal output isValid;
    signal output commitmentHash;
    
    // Verify amount <= maxAmount
    component amountCheck = LessEqThan(252);
    amountCheck.in[0] <== amount;
    amountCheck.in[1] <== maxAmount;
    
    // Verify amount <= balance
    component balanceCheck = LessEqThan(252);
    balanceCheck.in[0] <== amount;
    balanceCheck.in[1] <== agentBalance;
    
    // Verify amount > 0
    component positiveCheck = GreaterThan(252);
    positiveCheck.in[0] <== amount;
    positiveCheck.in[1] <== 0;
    
    // Compute commitment hash
    component commitHasher = Poseidon(4);
    commitHasher.inputs[0] <== transactionHash;
    commitHasher.inputs[1] <== amount;
    commitHasher.inputs[2] <== agentId;
    commitHasher.inputs[3] <== nonce;
    commitmentHash <== commitHasher.out;
    
    // All checks must pass
    isValid <== amountCheck.out * balanceCheck.out * positiveCheck.out;
}
`,
  mainComponent: 'component main {public [transactionHash, policyHash]} = TransactionValidity();',
};

/**
 * Recursive Proof Composition Circuit
 * 
 * Aggregates multiple proofs into a single proof,
 * enabling efficient verification of complex operations.
 */
export const RECURSIVE_COMPOSITION_CIRCUIT: CircomTemplate = {
  name: 'RecursiveComposition',
  description: 'Aggregates multiple proofs into one',
  pragma: 'circom 2.1.0',
  includes: [
    'circomlib/circuits/poseidon.circom',
  ],
  template: `
template RecursiveComposition(numProofs) {
    // Verification keys for inner proofs
    signal input vkHashes[numProofs];
    
    // Inner proof public inputs
    signal input innerPublicInputs[numProofs][10];
    
    // Inner proof validity (would be verified by verifier circuit)
    signal input innerProofValid[numProofs];
    
    signal output composedHash;
    signal output allValid;
    
    // Verify all inner proofs are valid
    allValid <== innerProofValid[0];
    for (var i = 1; i < numProofs; i++) {
        allValid <== allValid * innerProofValid[i];
    }
    
    // Compute composed hash of all public inputs
    component hasher = Poseidon(numProofs);
    for (var i = 0; i < numProofs; i++) {
        // Hash each proof's public inputs
        component innerHasher = Poseidon(10);
        for (var j = 0; j < 10; j++) {
            innerHasher.inputs[j] <== innerPublicInputs[i][j];
        }
        hasher.inputs[i] <== innerHasher.out;
    }
    composedHash <== hasher.out;
}
`,
  mainComponent: 'component main {public [vkHashes]} = RecursiveComposition(5);',
};

/**
 * Generate Circom file content from template
 */
export function generateCircomFile(template: CircomTemplate): string {
  const includes = template.includes.map(inc => `include "${inc}";`).join('\n');
  
  return `pragma circom ${template.pragma.split(' ')[1]};

// ${template.description}
// Auto-generated from Guthwine VAGNN Architecture

${includes}

${template.template}

${template.mainComponent}
`;
}

/**
 * Get all circuit templates
 */
export function getAllCircuitTemplates(): CircomTemplate[] {
  return [
    MERKLE_MEMBERSHIP_CIRCUIT,
    MERKLE_NON_MEMBERSHIP_CIRCUIT,
    DELEGATION_CHAIN_CIRCUIT,
    BATCH_ECDSA_CIRCUIT,
    TRANSACTION_VALIDITY_CIRCUIT,
    RECURSIVE_COMPOSITION_CIRCUIT,
  ];
}

export default {
  MERKLE_MEMBERSHIP_CIRCUIT,
  MERKLE_NON_MEMBERSHIP_CIRCUIT,
  DELEGATION_CHAIN_CIRCUIT,
  BATCH_ECDSA_CIRCUIT,
  TRANSACTION_VALIDITY_CIRCUIT,
  RECURSIVE_COMPOSITION_CIRCUIT,
  generateCircomFile,
  getAllCircuitTemplates,
};
