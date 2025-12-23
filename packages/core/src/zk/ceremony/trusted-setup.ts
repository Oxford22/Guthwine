/**
 * Guthwine - MPC Trusted Setup Ceremony
 * 
 * Implements the Powers of Tau ceremony for Groth16 zk-SNARKs.
 * This module automates the multi-party computation (MPC) ceremony
 * required to generate secure proving and verification keys.
 * 
 * Security Model:
 * - As long as ONE participant is honest and destroys their toxic waste,
 *   the setup is secure (1-of-N trust assumption)
 * - Random beacon adds public verifiability
 * - All contributions are cryptographically verified
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const execAsync = promisify(exec);

// Ceremony configuration
export interface CeremonyConfig {
  /** Elliptic curve (bn128 for Ethereum compatibility, bls12-381 for newer systems) */
  curve: 'bn128' | 'bls12-381';
  /** Power of 2 for max constraints (2^power). Higher = larger circuits but bigger files */
  power: number;
  /** Output directory for ceremony artifacts */
  outputDir: string;
  /** Circuit R1CS file path (for Phase 2) */
  circuitPath?: string;
  /** Enable verbose logging */
  verbose?: boolean;
}

export interface ContributionConfig {
  /** Participant name for audit trail */
  name: string;
  /** Custom entropy (optional - uses system randomness if not provided) */
  entropy?: string;
  /** Input ptau file */
  inputFile: string;
  /** Output ptau file */
  outputFile: string;
}

export interface BeaconConfig {
  /** Random beacon value (e.g., Bitcoin block hash) */
  beaconHash: string;
  /** Number of hash iterations (2^iterations) */
  iterations: number;
  /** Input ptau file */
  inputFile: string;
  /** Output ptau file */
  outputFile: string;
}

export interface Phase2Config {
  /** Prepared ptau file from Phase 1 */
  ptauFile: string;
  /** Circuit R1CS file */
  r1csFile: string;
  /** Output zkey file */
  zkeyFile: string;
  /** Participant name */
  name: string;
  /** Custom entropy */
  entropy?: string;
}

/**
 * MPC Trusted Setup Ceremony Manager
 * 
 * Orchestrates the Powers of Tau ceremony for generating
 * cryptographically secure zk-SNARK parameters.
 */
export class TrustedSetupCeremony {
  private config: CeremonyConfig;
  private snarkjsPath: string;

  constructor(config: CeremonyConfig) {
    this.config = config;
    this.snarkjsPath = 'npx snarkjs';
    
    // Ensure output directory exists
    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
    }
  }

  /**
   * Phase 1: Initialize the Powers of Tau ceremony
   * 
   * Creates the initial ptau file with the specified curve and constraint power.
   * This is the starting point for the MPC ceremony.
   */
  async initializeCeremony(): Promise<string> {
    const outputFile = path.join(
      this.config.outputDir,
      `pot${this.config.power}_0000.ptau`
    );

    this.log(`Initializing Powers of Tau ceremony...`);
    this.log(`  Curve: ${this.config.curve}`);
    this.log(`  Power: ${this.config.power} (max ${Math.pow(2, this.config.power)} constraints)`);

    const cmd = `${this.snarkjsPath} powersoftau new ${this.config.curve} ${this.config.power} ${outputFile} -v`;
    
    await this.executeCommand(cmd, 'Ceremony initialization');
    
    this.log(`✓ Initial ptau file created: ${outputFile}`);
    return outputFile;
  }

  /**
   * Add a contribution to the ceremony
   * 
   * Each participant adds their entropy to the ceremony chain.
   * The contribution is cryptographically bound to the previous state.
   */
  async contribute(config: ContributionConfig): Promise<string> {
    this.log(`Adding contribution from: ${config.name}`);

    // Generate entropy if not provided
    const entropy = config.entropy || this.generateEntropy();
    
    // Build command with entropy
    let cmd = `${this.snarkjsPath} powersoftau contribute ${config.inputFile} ${config.outputFile}`;
    cmd += ` --name="${config.name}"`;
    cmd += ` -e="${entropy}"`;
    cmd += ' -v';

    await this.executeCommand(cmd, `Contribution from ${config.name}`);

    // Verify the contribution
    await this.verifyContribution(config.outputFile);

    this.log(`✓ Contribution verified and saved: ${config.outputFile}`);
    return config.outputFile;
  }

  /**
   * Verify a ptau file's cryptographic integrity
   * 
   * Ensures the contribution chain is unbroken and all
   * cryptographic proofs are valid.
   */
  async verifyContribution(ptauFile: string): Promise<boolean> {
    this.log(`Verifying contribution: ${ptauFile}`);

    const cmd = `${this.snarkjsPath} powersoftau verify ${ptauFile}`;
    
    try {
      await this.executeCommand(cmd, 'Verification');
      this.log(`✓ Verification passed`);
      return true;
    } catch (error) {
      this.log(`✗ Verification FAILED`);
      throw new Error(`Contribution verification failed: ${error}`);
    }
  }

  /**
   * Apply a random beacon to finalize Phase 1
   * 
   * The beacon adds public verifiability by incorporating
   * a publicly known random value (e.g., Bitcoin block hash).
   * This prevents any participant from biasing the final output.
   */
  async applyBeacon(config: BeaconConfig): Promise<string> {
    this.log(`Applying random beacon...`);
    this.log(`  Beacon hash: ${config.beaconHash}`);
    this.log(`  Iterations: 2^${config.iterations}`);

    const cmd = `${this.snarkjsPath} powersoftau beacon ${config.inputFile} ${config.outputFile} ${config.beaconHash} ${config.iterations} -n="Final Beacon" -v`;

    await this.executeCommand(cmd, 'Beacon application');

    this.log(`✓ Beacon applied: ${config.outputFile}`);
    return config.outputFile;
  }

  /**
   * Prepare Phase 1 output for Phase 2
   * 
   * Calculates Lagrange polynomials required for circuit-specific setup.
   */
  async preparePhase2(inputFile: string): Promise<string> {
    const outputFile = inputFile.replace('.ptau', '_prepared.ptau');

    this.log(`Preparing for Phase 2...`);

    const cmd = `${this.snarkjsPath} powersoftau prepare phase2 ${inputFile} ${outputFile} -v`;

    await this.executeCommand(cmd, 'Phase 2 preparation');

    this.log(`✓ Phase 2 prepared: ${outputFile}`);
    return outputFile;
  }

  /**
   * Phase 2: Circuit-specific setup
   * 
   * Binds the universal Phase 1 parameters to a specific circuit.
   * This generates the proving key (zkey) for the circuit.
   */
  async setupPhase2(config: Phase2Config): Promise<string> {
    this.log(`Starting Phase 2 setup...`);
    this.log(`  Circuit: ${config.r1csFile}`);

    // Initial zkey generation
    const initialZkey = config.zkeyFile.replace('.zkey', '_0000.zkey');
    let cmd = `${this.snarkjsPath} groth16 setup ${config.r1csFile} ${config.ptauFile} ${initialZkey}`;
    
    await this.executeCommand(cmd, 'Initial zkey generation');

    // Contribute to Phase 2
    const entropy = config.entropy || this.generateEntropy();
    cmd = `${this.snarkjsPath} zkey contribute ${initialZkey} ${config.zkeyFile}`;
    cmd += ` --name="${config.name}"`;
    cmd += ` -e="${entropy}"`;
    cmd += ' -v';

    await this.executeCommand(cmd, 'Phase 2 contribution');

    this.log(`✓ Phase 2 complete: ${config.zkeyFile}`);
    return config.zkeyFile;
  }

  /**
   * Export verification key from zkey
   * 
   * The verification key is used by the verifier to check proofs.
   * This is a public artifact that can be shared freely.
   */
  async exportVerificationKey(zkeyFile: string): Promise<string> {
    const vkeyFile = zkeyFile.replace('.zkey', '_verification_key.json');

    this.log(`Exporting verification key...`);

    const cmd = `${this.snarkjsPath} zkey export verificationkey ${zkeyFile} ${vkeyFile}`;

    await this.executeCommand(cmd, 'Verification key export');

    this.log(`✓ Verification key exported: ${vkeyFile}`);
    return vkeyFile;
  }

  /**
   * Export Solidity verifier contract
   * 
   * Generates a Solidity smart contract that can verify proofs on-chain.
   * This enables trustless verification on Ethereum-compatible blockchains.
   */
  async exportSolidityVerifier(zkeyFile: string): Promise<string> {
    const verifierFile = zkeyFile.replace('.zkey', '_verifier.sol');

    this.log(`Exporting Solidity verifier...`);

    const cmd = `${this.snarkjsPath} zkey export solidityverifier ${zkeyFile} ${verifierFile}`;

    await this.executeCommand(cmd, 'Solidity verifier export');

    this.log(`✓ Solidity verifier exported: ${verifierFile}`);
    return verifierFile;
  }

  /**
   * Run a complete ceremony with multiple participants
   * 
   * Orchestrates the full MPC ceremony from initialization to final artifacts.
   */
  async runFullCeremony(participants: string[], beaconHash: string): Promise<CeremonyResult> {
    this.log('═══════════════════════════════════════════════════════════');
    this.log('  GUTHWINE - MPC TRUSTED SETUP CEREMONY');
    this.log('  "In the hands of a worthy bearer, never fails."');
    this.log('═══════════════════════════════════════════════════════════');

    const result: CeremonyResult = {
      phase1: {
        initialFile: '',
        contributions: [],
        beaconFile: '',
        preparedFile: '',
      },
      phase2: {
        zkeyFile: '',
        verificationKeyFile: '',
        solidityVerifierFile: '',
      },
      metadata: {
        curve: this.config.curve,
        power: this.config.power,
        participants: participants,
        beaconHash: beaconHash,
        timestamp: new Date().toISOString(),
      },
    };

    // Phase 1: Powers of Tau
    this.log('\n📜 PHASE 1: Powers of Tau\n');

    // Initialize
    result.phase1.initialFile = await this.initializeCeremony();

    // Contributions
    let currentFile = result.phase1.initialFile;
    for (let i = 0; i < participants.length; i++) {
      const outputFile = path.join(
        this.config.outputDir,
        `pot${this.config.power}_${String(i + 1).padStart(4, '0')}.ptau`
      );

      currentFile = await this.contribute({
        name: participants[i]!,
        inputFile: currentFile,
        outputFile: outputFile,
      });

      result.phase1.contributions.push({
        participant: participants[i]!,
        file: currentFile,
      });
    }

    // Apply beacon
    const beaconFile = path.join(
      this.config.outputDir,
      `pot${this.config.power}_beacon.ptau`
    );
    result.phase1.beaconFile = await this.applyBeacon({
      beaconHash: beaconHash,
      iterations: 10,
      inputFile: currentFile,
      outputFile: beaconFile,
    });

    // Prepare for Phase 2
    result.phase1.preparedFile = await this.preparePhase2(result.phase1.beaconFile);

    // Phase 2: Circuit-specific (if circuit provided)
    if (this.config.circuitPath) {
      this.log('\n📜 PHASE 2: Circuit-Specific Setup\n');

      const zkeyFile = path.join(
        this.config.outputDir,
        'circuit_final.zkey'
      );

      const zkeyResult = await this.setupPhase2({
        ptauFile: result.phase1.preparedFile,
        r1csFile: this.config.circuitPath,
        zkeyFile: zkeyFile,
        name: 'Guthwine Ceremony',
      });

      result.phase2.zkeyFile = zkeyResult;
      result.phase2.verificationKeyFile = await this.exportVerificationKey(zkeyResult);
      result.phase2.solidityVerifierFile = await this.exportSolidityVerifier(zkeyResult);
    }

    // Save ceremony metadata
    const metadataFile = path.join(this.config.outputDir, 'ceremony_metadata.json');
    fs.writeFileSync(metadataFile, JSON.stringify(result, null, 2));

    this.log('\n═══════════════════════════════════════════════════════════');
    this.log('  ✓ CEREMONY COMPLETE');
    this.log('═══════════════════════════════════════════════════════════');
    this.log(`\nArtifacts saved to: ${this.config.outputDir}`);

    return result;
  }

  /**
   * Generate cryptographically secure entropy
   */
  private generateEntropy(): string {
    // Combine multiple entropy sources
    const systemRandom = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now().toString();
    const processEntropy = process.pid.toString() + process.hrtime.bigint().toString();
    
    // Hash all sources together
    return crypto
      .createHash('sha256')
      .update(systemRandom + timestamp + processEntropy)
      .digest('hex');
  }

  /**
   * Execute a shell command with logging
   */
  private async executeCommand(cmd: string, description: string): Promise<string> {
    if (this.config.verbose) {
      this.log(`  [CMD] ${cmd}`);
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer for large operations
      });
      
      if (this.config.verbose && stdout) {
        this.log(`  [OUT] ${stdout.slice(0, 500)}...`);
      }
      
      return stdout;
    } catch (error: any) {
      throw new Error(`${description} failed: ${error.message}`);
    }
  }

  private log(message: string): void {
    console.log(message);
  }
}

// Result types
export interface CeremonyResult {
  phase1: {
    initialFile: string;
    contributions: Array<{ participant: string; file: string }>;
    beaconFile: string;
    preparedFile: string;
  };
  phase2: {
    zkeyFile: string;
    verificationKeyFile: string;
    solidityVerifierFile: string;
  };
  metadata: {
    curve: string;
    power: number;
    participants: string[];
    beaconHash: string;
    timestamp: string;
  };
}

/**
 * Ceremony Coordinator for distributed MPC
 * 
 * Manages the coordination of multiple participants
 * in a distributed ceremony setup.
 */
export class CeremonyCoordinator {
  private ceremony: TrustedSetupCeremony;
  private participants: Map<string, ParticipantInfo>;
  private currentContributor: number;
  private state: CeremonyState;

  constructor(config: CeremonyConfig) {
    this.ceremony = new TrustedSetupCeremony(config);
    this.participants = new Map();
    this.currentContributor = 0;
    this.state = CeremonyState.INITIALIZED;
  }

  /**
   * Register a participant for the ceremony
   */
  registerParticipant(info: ParticipantInfo): void {
    if (this.state !== CeremonyState.INITIALIZED) {
      throw new Error('Cannot register participants after ceremony has started');
    }
    this.participants.set(info.id, info);
  }

  /**
   * Start the ceremony
   */
  async start(): Promise<string> {
    if (this.participants.size === 0) {
      throw new Error('No participants registered');
    }

    this.state = CeremonyState.PHASE1_ACTIVE;
    return await this.ceremony.initializeCeremony();
  }

  /**
   * Process a contribution from a participant
   */
  async processContribution(
    participantId: string,
    inputFile: string,
    entropy?: string
  ): Promise<string> {
    const participant = this.participants.get(participantId);
    if (!participant) {
      throw new Error(`Unknown participant: ${participantId}`);
    }

    const outputFile = inputFile.replace(
      /(\d{4})\.ptau$/,
      `${String(this.currentContributor + 1).padStart(4, '0')}.ptau`
    );

    const result = await this.ceremony.contribute({
      name: participant.name,
      inputFile,
      outputFile,
      entropy,
    });

    this.currentContributor++;
    participant.contributed = true;

    return result;
  }

  /**
   * Finalize the ceremony with a random beacon
   */
  async finalize(beaconHash: string): Promise<string> {
    if (this.state !== CeremonyState.PHASE1_ACTIVE) {
      throw new Error('Ceremony not in active state');
    }

    // Verify all participants have contributed
    for (const [id, participant] of this.participants) {
      if (!participant.contributed) {
        throw new Error(`Participant ${id} has not contributed`);
      }
    }

    this.state = CeremonyState.FINALIZING;

    // Get the last contribution file
    const lastFile = path.join(
      this.ceremony['config'].outputDir,
      `pot${this.ceremony['config'].power}_${String(this.currentContributor).padStart(4, '0')}.ptau`
    );

    const beaconFile = lastFile.replace(/\d{4}\.ptau$/, 'beacon.ptau');

    const result = await this.ceremony.applyBeacon({
      beaconHash,
      iterations: 10,
      inputFile: lastFile,
      outputFile: beaconFile,
    });

    this.state = CeremonyState.COMPLETED;
    return result;
  }

  getState(): CeremonyState {
    return this.state;
  }

  getParticipants(): ParticipantInfo[] {
    return Array.from(this.participants.values());
  }
}

export interface ParticipantInfo {
  id: string;
  name: string;
  publicKey?: string;
  contributed?: boolean;
  contributionHash?: string;
}

export enum CeremonyState {
  INITIALIZED = 'initialized',
  PHASE1_ACTIVE = 'phase1_active',
  PHASE2_ACTIVE = 'phase2_active',
  FINALIZING = 'finalizing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Export factory function
export function createCeremony(config: CeremonyConfig): TrustedSetupCeremony {
  return new TrustedSetupCeremony(config);
}

export function createCoordinator(config: CeremonyConfig): CeremonyCoordinator {
  return new CeremonyCoordinator(config);
}
