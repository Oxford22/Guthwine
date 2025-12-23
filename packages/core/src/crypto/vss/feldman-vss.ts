/**
 * Feldman's Verifiable Secret Sharing (VSS)
 * 
 * Implements Shamir's Secret Sharing with cryptographic commitments
 * to verify share integrity without revealing the secret.
 * 
 * Mathematical Foundation:
 * - Secret S is the constant term a_0 of polynomial f(x) = a_0 + a_1*x + ... + a_{k-1}*x^{k-1}
 * - Each share is a point (i, f(i)) on the polynomial
 * - k shares can reconstruct S via Lagrange interpolation
 * - Commitments C_i = g^{a_i} allow verification: g^{y_i} = Π_{j=0}^{k-1} (C_j)^{i^j}
 */

import * as crypto from 'crypto';

// Using a large prime for finite field arithmetic (256-bit)
// This is the order of the secp256k1 curve for compatibility
const PRIME = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

// Generator point (simplified - in production use actual curve point)
const GENERATOR = BigInt(2);

export interface Share {
  index: number;
  value: bigint;
}

export interface Commitment {
  index: number;
  value: bigint;
}

export interface VSSResult {
  shares: Share[];
  commitments: Commitment[];
  threshold: number;
  totalShares: number;
}

export interface ShareVerification {
  isValid: boolean;
  shareIndex: number;
  computedCommitment: bigint;
  expectedCommitment: bigint;
}

/**
 * Modular exponentiation: base^exp mod mod
 */
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  base = ((base % mod) + mod) % mod;
  
  while (exp > BigInt(0)) {
    if (exp % BigInt(2) === BigInt(1)) {
      result = (result * base) % mod;
    }
    exp = exp / BigInt(2);
    base = (base * base) % mod;
  }
  
  return result;
}

/**
 * Modular inverse using extended Euclidean algorithm
 */
function modInverse(a: bigint, mod: bigint): bigint {
  a = ((a % mod) + mod) % mod;
  
  let [oldR, r] = [a, mod];
  let [oldS, s] = [BigInt(1), BigInt(0)];
  
  while (r !== BigInt(0)) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  
  return ((oldS % mod) + mod) % mod;
}

/**
 * Generate a cryptographically secure random bigint in range [0, max)
 */
function randomBigInt(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  let result: bigint;
  
  do {
    const bytes = crypto.randomBytes(byteLength);
    result = BigInt('0x' + bytes.toString('hex'));
  } while (result >= max);
  
  return result;
}

/**
 * Evaluate polynomial at point x
 * f(x) = a_0 + a_1*x + a_2*x^2 + ... + a_{k-1}*x^{k-1}
 */
function evaluatePolynomial(coefficients: bigint[], x: bigint, mod: bigint): bigint {
  let result = BigInt(0);
  let xPower = BigInt(1);
  
  for (const coeff of coefficients) {
    result = (result + coeff * xPower) % mod;
    xPower = (xPower * x) % mod;
  }
  
  return result;
}

/**
 * Lagrange interpolation to recover secret from k shares
 */
function lagrangeInterpolation(shares: Share[], mod: bigint): bigint {
  let secret = BigInt(0);
  const k = shares.length;
  
  for (let i = 0; i < k; i++) {
    let numerator = BigInt(1);
    let denominator = BigInt(1);
    
    const shareI = shares[i];
    if (!shareI) continue;
    
    for (let j = 0; j < k; j++) {
      if (i !== j) {
        const shareJ = shares[j];
        if (!shareJ) continue;
        
        const xi = BigInt(shareI.index);
        const xj = BigInt(shareJ.index);
        
        // We want f(0), so numerator is product of -xj = (0 - xj)
        numerator = (numerator * (-xj)) % mod;
        // Denominator is product of (xi - xj)
        denominator = (denominator * (xi - xj)) % mod;
      }
    }
    
    // Ensure positive modular arithmetic
    numerator = ((numerator % mod) + mod) % mod;
    denominator = ((denominator % mod) + mod) % mod;
    
    // Lagrange basis polynomial L_i(0)
    const lagrangeBasis = (numerator * modInverse(denominator, mod)) % mod;
    
    // Add contribution: y_i * L_i(0)
    secret = (secret + shareI.value * lagrangeBasis) % mod;
  }
  
  return ((secret % mod) + mod) % mod;
}

/**
 * Feldman's Verifiable Secret Sharing
 */
export class FeldmanVSS {
  private prime: bigint;
  private generator: bigint;
  
  constructor(prime: bigint = PRIME, generator: bigint = GENERATOR) {
    this.prime = prime;
    this.generator = generator;
  }
  
  /**
   * Split a secret into n shares where any k shares can reconstruct it
   * 
   * @param secret - The secret to split (as bigint or hex string)
   * @param threshold - Minimum shares needed to reconstruct (k)
   * @param totalShares - Total number of shares to generate (n)
   * @returns Shares and commitments for verification
   */
  split(secret: bigint | string, threshold: number, totalShares: number): VSSResult {
    if (threshold > totalShares) {
      throw new Error('Threshold cannot exceed total shares');
    }
    if (threshold < 2) {
      throw new Error('Threshold must be at least 2');
    }
    
    // Convert hex string to bigint if needed
    const secretBigInt = typeof secret === 'string' 
      ? BigInt('0x' + secret.replace(/^0x/, ''))
      : secret;
    
    // Generate random polynomial coefficients
    // a_0 = secret, a_1...a_{k-1} are random
    const coefficients: bigint[] = [secretBigInt % this.prime];
    
    for (let i = 1; i < threshold; i++) {
      coefficients.push(randomBigInt(this.prime));
    }
    
    // Generate shares: (i, f(i)) for i = 1 to n
    const shares: Share[] = [];
    for (let i = 1; i <= totalShares; i++) {
      const value = evaluatePolynomial(coefficients, BigInt(i), this.prime);
      shares.push({ index: i, value });
    }
    
    // Generate Feldman commitments: C_i = g^{a_i} mod p
    const commitments: Commitment[] = [];
    for (let i = 0; i < threshold; i++) {
      const coeff = coefficients[i];
      if (coeff !== undefined) {
        const value = modPow(this.generator, coeff, this.prime);
        commitments.push({ index: i, value });
      }
    }
    
    return {
      shares,
      commitments,
      threshold,
      totalShares,
    };
  }
  
  /**
   * Verify a share against the public commitments
   * 
   * Verification: g^{y_i} = Π_{j=0}^{k-1} (C_j)^{i^j}
   * 
   * @param share - The share to verify
   * @param commitments - The public commitments
   * @returns Verification result
   */
  verifyShare(share: Share, commitments: Commitment[]): ShareVerification {
    const i = BigInt(share.index);
    
    // Left side: g^{y_i}
    const leftSide = modPow(this.generator, share.value, this.prime);
    
    // Right side: Π_{j=0}^{k-1} (C_j)^{i^j}
    let rightSide = BigInt(1);
    let iPower = BigInt(1);
    
    for (const commitment of commitments) {
      const term = modPow(commitment.value, iPower, this.prime);
      rightSide = (rightSide * term) % this.prime;
      iPower = (iPower * i) % this.prime;
    }
    
    return {
      isValid: leftSide === rightSide,
      shareIndex: share.index,
      computedCommitment: leftSide,
      expectedCommitment: rightSide,
    };
  }
  
  /**
   * Verify all shares against commitments
   */
  verifyAllShares(shares: Share[], commitments: Commitment[]): ShareVerification[] {
    return shares.map(share => this.verifyShare(share, commitments));
  }
  
  /**
   * Reconstruct the secret from k or more shares
   * 
   * @param shares - Array of shares (must have at least threshold shares)
   * @param threshold - The threshold used during splitting
   * @returns The reconstructed secret
   */
  reconstruct(shares: Share[], threshold: number): bigint {
    if (shares.length < threshold) {
      throw new Error(`Need at least ${threshold} shares, got ${shares.length}`);
    }
    
    // Use exactly threshold shares for reconstruction
    const selectedShares = shares.slice(0, threshold);
    
    return lagrangeInterpolation(selectedShares, this.prime);
  }
  
  /**
   * Reconstruct with verification - only use verified shares
   */
  reconstructWithVerification(
    shares: Share[],
    commitments: Commitment[],
    threshold: number
  ): { secret: bigint; usedShares: number[]; invalidShares: number[] } {
    const verifications = this.verifyAllShares(shares, commitments);
    
    const validShares: Share[] = [];
    const invalidShareIndices: number[] = [];
    
    for (let i = 0; i < verifications.length; i++) {
      const verification = verifications[i];
      const share = shares[i];
      if (verification && share) {
        if (verification.isValid) {
          validShares.push(share);
        } else {
          invalidShareIndices.push(share.index);
        }
      }
    }
    
    if (validShares.length < threshold) {
      throw new Error(
        `Not enough valid shares. Need ${threshold}, got ${validShares.length}. ` +
        `Invalid shares: ${invalidShareIndices.join(', ')}`
      );
    }
    
    const secret = this.reconstruct(validShares, threshold);
    
    return {
      secret,
      usedShares: validShares.slice(0, threshold).map(s => s.index),
      invalidShares: invalidShareIndices,
    };
  }
  
  /**
   * Serialize a share for storage/transmission
   */
  serializeShare(share: Share): string {
    return JSON.stringify({
      index: share.index,
      value: share.value.toString(16),
    });
  }
  
  /**
   * Deserialize a share from storage/transmission
   */
  deserializeShare(serialized: string): Share {
    const parsed = JSON.parse(serialized) as { index: number; value: string };
    return {
      index: parsed.index,
      value: BigInt('0x' + parsed.value),
    };
  }
  
  /**
   * Serialize commitments for public distribution
   */
  serializeCommitments(commitments: Commitment[]): string {
    return JSON.stringify(
      commitments.map(c => ({
        index: c.index,
        value: c.value.toString(16),
      }))
    );
  }
  
  /**
   * Deserialize commitments
   */
  deserializeCommitments(serialized: string): Commitment[] {
    const parsed = JSON.parse(serialized) as Array<{ index: number; value: string }>;
    return parsed.map((c) => ({
      index: c.index,
      value: BigInt('0x' + c.value),
    }));
  }
}

/**
 * Distributed Key Generation (DKG) using Feldman VSS
 * 
 * Allows multiple parties to jointly generate a shared secret
 * where no single party knows the full secret.
 */
export class DistributedKeyGeneration {
  private vss: FeldmanVSS;
  private threshold: number;
  private totalParties: number;
  private partyId: number;
  
  // Collected shares and commitments from all parties
  private receivedShares: Map<number, Share> = new Map();
  private receivedCommitments: Map<number, Commitment[]> = new Map();
  
  // This party's contribution
  private myVSSResult?: VSSResult;
  
  constructor(partyId: number, threshold: number, totalParties: number) {
    this.vss = new FeldmanVSS();
    this.partyId = partyId;
    this.threshold = threshold;
    this.totalParties = totalParties;
  }
  
  /**
   * Phase 1: Generate this party's contribution
   * Returns shares to distribute to other parties and commitments to broadcast
   */
  generateContribution(): { sharesToDistribute: Map<number, Share>; commitments: Commitment[] } {
    // Generate a random secret contribution
    const mySecret = randomBigInt(PRIME);
    
    // Split using VSS
    this.myVSSResult = this.vss.split(mySecret, this.threshold, this.totalParties);
    
    // Map shares to party IDs
    const sharesToDistribute = new Map<number, Share>();
    for (const share of this.myVSSResult.shares) {
      sharesToDistribute.set(share.index, share);
    }
    
    return {
      sharesToDistribute,
      commitments: this.myVSSResult.commitments,
    };
  }
  
  /**
   * Phase 2: Receive share from another party
   */
  receiveShare(fromPartyId: number, share: Share, commitments: Commitment[]): boolean {
    // Verify the share
    const verification = this.vss.verifyShare(share, commitments);
    
    if (verification.isValid) {
      this.receivedShares.set(fromPartyId, share);
      this.receivedCommitments.set(fromPartyId, commitments);
      return true;
    }
    
    return false;
  }
  
  /**
   * Phase 3: Compute final share of the distributed key
   * 
   * The distributed secret is the sum of all parties' secrets.
   * Each party's final share is the sum of all shares they received.
   */
  computeFinalShare(): Share {
    if (this.receivedShares.size < this.threshold) {
      throw new Error(
        `Not enough shares received. Need ${this.threshold}, got ${this.receivedShares.size}`
      );
    }
    
    // Sum all received shares (including our own share for ourselves)
    let finalValue = BigInt(0);
    
    for (const share of this.receivedShares.values()) {
      finalValue = (finalValue + share.value) % PRIME;
    }
    
    // Add our own share to ourselves
    if (this.myVSSResult) {
      const myShare = this.myVSSResult.shares.find(s => s.index === this.partyId);
      if (myShare) {
        finalValue = (finalValue + myShare.value) % PRIME;
      }
    }
    
    return {
      index: this.partyId,
      value: finalValue,
    };
  }
  
  /**
   * Compute the public key (commitment to the distributed secret)
   */
  computePublicKey(): bigint {
    // The public key is the product of all parties' first commitments (C_0)
    let publicKey = BigInt(1);
    
    for (const commitments of this.receivedCommitments.values()) {
      const firstCommitment = commitments[0];
      if (firstCommitment) {
        publicKey = (publicKey * firstCommitment.value) % PRIME;
      }
    }
    
    // Include our own commitment
    if (this.myVSSResult) {
      const myFirstCommitment = this.myVSSResult.commitments[0];
      if (myFirstCommitment) {
        publicKey = (publicKey * myFirstCommitment.value) % PRIME;
      }
    }
    
    return publicKey;
  }
}

export { PRIME, GENERATOR, modPow, modInverse, randomBigInt };
