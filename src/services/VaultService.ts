/**
 * Guthwine - Vault Service
 * Secure storage for API keys and secrets using AES-256-GCM encryption
 */

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

export class VaultService {
  private prisma: PrismaClient;
  private encryptionKey: Buffer;

  constructor(prisma: PrismaClient, masterKey?: string) {
    this.prisma = prisma;
    // Derive encryption key from master key or use environment variable
    const key = masterKey || process.env.GUTHWINE_MASTER_KEY || 'default-dev-key-change-in-production';
    this.encryptionKey = crypto.scryptSync(key, 'guthwine-salt', 32);
  }

  /**
   * Encrypt a value using AES-256-GCM
   */
  private encrypt(plaintext: string): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  /**
   * Decrypt a value using AES-256-GCM
   */
  private decrypt(encrypted: string, iv: string, authTag: string): string {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Store a secret in the vault
   */
  async storeSecret(keyName: string, value: string): Promise<void> {
    const { encrypted, iv, authTag } = this.encrypt(value);

    await this.prisma.secureVault.upsert({
      where: { keyName },
      update: {
        encryptedValue: encrypted,
        iv,
        authTag,
      },
      create: {
        keyName,
        encryptedValue: encrypted,
        iv,
        authTag,
      },
    });
  }

  /**
   * Retrieve a secret from the vault
   */
  async getSecret(keyName: string): Promise<string | null> {
    const entry = await this.prisma.secureVault.findUnique({
      where: { keyName },
    });

    if (!entry) {
      return null;
    }

    return this.decrypt(entry.encryptedValue, entry.iv, entry.authTag);
  }

  /**
   * Delete a secret from the vault
   */
  async deleteSecret(keyName: string): Promise<boolean> {
    try {
      await this.prisma.secureVault.delete({
        where: { keyName },
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all stored key names (not values)
   */
  async listKeys(): Promise<string[]> {
    const entries = await this.prisma.secureVault.findMany({
      select: { keyName: true },
    });
    return entries.map((e) => e.keyName);
  }

  /**
   * Generate a new key pair for agent identity
   */
  generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicKey, privateKey };
  }

  /**
   * Store an encrypted private key for an agent
   */
  async storeAgentPrivateKey(agentDid: string, privateKey: string): Promise<void> {
    await this.storeSecret(`agent_private_key:${agentDid}`, privateKey);
  }

  /**
   * Retrieve an agent's private key
   */
  async getAgentPrivateKey(agentDid: string): Promise<string | null> {
    return this.getSecret(`agent_private_key:${agentDid}`);
  }

  /**
   * Sign data with an agent's private key
   */
  async signWithAgentKey(agentDid: string, data: string): Promise<string | null> {
    const privateKey = await this.getAgentPrivateKey(agentDid);
    if (!privateKey) {
      return null;
    }

    const sign = crypto.createSign('SHA256');
    sign.update(data);
    return sign.sign(privateKey, 'hex');
  }

  /**
   * Verify a signature with an agent's public key
   */
  verifySignature(publicKey: string, data: string, signature: string): boolean {
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      return verify.verify(publicKey, signature, 'hex');
    } catch {
      return false;
    }
  }

  /**
   * Hash data using SHA-256
   */
  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}
