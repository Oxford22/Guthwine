/**
 * SQLite Adapter for Zero-Dependency Demo
 * 
 * Uses better-sqlite3 for synchronous, serverless database operations.
 * Enables WAL mode for concurrent read/write operations.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

export interface Agent {
  id: string;
  did: string;
  name: string;
  organizationId: string;
  status: 'ACTIVE' | 'FROZEN' | 'REVOKED';
  publicKey: string;
  privateKeyEncrypted?: string;
  capabilities: Record<string, unknown>;
  spendingLimits: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Policy {
  id: string;
  name: string;
  organizationId: string;
  scope: 'GLOBAL' | 'ORGANIZATION' | 'AGENT';
  effect: 'ALLOW' | 'DENY';
  priority: number;
  rules: Record<string, unknown>;
  conditions: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  agentId: string;
  organizationId: string;
  type: string;
  action: string;
  amount?: number;
  currency?: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXECUTED' | 'FAILED';
  reason: string;
  policyEvaluation: Record<string, unknown>;
  mandateToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  agentId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  payload: Record<string, unknown>;
  entryHash: string;
  previousHash?: string;
  createdAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  tier: 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  settings: Record<string, unknown>;
  globalFreeze: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class SqliteAdapter {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'guthwine_demo.db');
    
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    
    // Enable WAL mode for concurrent read/write
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      -- Organizations
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        tier TEXT DEFAULT 'FREE',
        settings TEXT DEFAULT '{}',
        global_freeze INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Agents
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        did TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        public_key TEXT NOT NULL,
        private_key_encrypted TEXT,
        capabilities TEXT DEFAULT '{}',
        spending_limits TEXT DEFAULT '{}',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      -- Policies
      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        scope TEXT DEFAULT 'ORGANIZATION',
        effect TEXT DEFAULT 'ALLOW',
        priority INTEGER DEFAULT 0,
        rules TEXT DEFAULT '{}',
        conditions TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      -- Policy Assignments
      CREATE TABLE IF NOT EXISTS policy_assignments (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (policy_id) REFERENCES policies(id),
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      );

      -- Transactions
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        type TEXT NOT NULL,
        action TEXT NOT NULL,
        amount REAL,
        currency TEXT,
        status TEXT DEFAULT 'PENDING',
        reason TEXT,
        policy_evaluation TEXT DEFAULT '{}',
        mandate_token TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      -- Audit Logs
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        agent_id TEXT,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT,
        payload TEXT DEFAULT '{}',
        entry_hash TEXT NOT NULL,
        previous_hash TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      -- Delegation Tokens
      CREATE TABLE IF NOT EXISTS delegation_tokens (
        id TEXT PRIMARY KEY,
        issuer_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        organization_id TEXT NOT NULL,
        permissions TEXT DEFAULT '[]',
        constraints TEXT DEFAULT '{}',
        token TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        expires_at TEXT,
        usage_count INTEGER DEFAULT 0,
        max_uses INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (issuer_id) REFERENCES agents(id),
        FOREIGN KEY (subject_id) REFERENCES agents(id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id)
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(organization_id);
      CREATE INDEX IF NOT EXISTS idx_agents_did ON agents(did);
      CREATE INDEX IF NOT EXISTS idx_policies_org ON policies(organization_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_agent ON transactions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
    `);
  }

  // Organization methods
  createOrganization(data: Partial<Organization>): Organization {
    const id = data.id || randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO organizations (id, name, slug, tier, settings, global_freeze)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.name || 'Demo Organization',
      data.slug || 'demo-org',
      data.tier || 'FREE',
      JSON.stringify(data.settings || {}),
      data.globalFreeze ? 1 : 0
    );

    return this.getOrganization(id)!;
  }

  getOrganization(id: string): Organization | null {
    const row = this.db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      tier: row.tier,
      settings: JSON.parse(row.settings || '{}'),
      globalFreeze: Boolean(row.global_freeze),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Agent methods
  createAgent(data: Partial<Agent>): Agent {
    const id = data.id || randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO agents (id, did, name, organization_id, status, public_key, private_key_encrypted, capabilities, spending_limits, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.did || `did:guthwine:${id}`,
      data.name || 'Demo Agent',
      data.organizationId,
      data.status || 'ACTIVE',
      data.publicKey || '',
      data.privateKeyEncrypted || null,
      JSON.stringify(data.capabilities || {}),
      JSON.stringify(data.spendingLimits || {}),
      JSON.stringify(data.metadata || {})
    );

    return this.getAgent(id)!;
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.mapAgent(row);
  }

  getAgentByDid(did: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE did = ?').get(did) as any;
    if (!row) return null;
    
    return this.mapAgent(row);
  }

  updateAgent(id: string, data: Partial<Agent>): Agent | null {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.capabilities !== undefined) {
      updates.push('capabilities = ?');
      values.push(JSON.stringify(data.capabilities));
    }
    if (data.spendingLimits !== undefined) {
      updates.push('spending_limits = ?');
      values.push(JSON.stringify(data.spendingLimits));
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      values.push(id);
      this.db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getAgent(id);
  }

  listAgents(organizationId: string): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents WHERE organization_id = ?').all(organizationId) as any[];
    return rows.map(row => this.mapAgent(row));
  }

  private mapAgent(row: any): Agent {
    return {
      id: row.id,
      did: row.did,
      name: row.name,
      organizationId: row.organization_id,
      status: row.status,
      publicKey: row.public_key,
      privateKeyEncrypted: row.private_key_encrypted,
      capabilities: JSON.parse(row.capabilities || '{}'),
      spendingLimits: JSON.parse(row.spending_limits || '{}'),
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Policy methods
  createPolicy(data: Partial<Policy>): Policy {
    const id = data.id || randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO policies (id, name, organization_id, scope, effect, priority, rules, conditions, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.name || 'Demo Policy',
      data.organizationId,
      data.scope || 'ORGANIZATION',
      data.effect || 'ALLOW',
      data.priority || 0,
      JSON.stringify(data.rules || {}),
      JSON.stringify(data.conditions || {}),
      data.isActive !== false ? 1 : 0
    );

    return this.getPolicy(id)!;
  }

  getPolicy(id: string): Policy | null {
    const row = this.db.prepare('SELECT * FROM policies WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.mapPolicy(row);
  }

  listPolicies(organizationId: string): Policy[] {
    const rows = this.db.prepare(
      'SELECT * FROM policies WHERE organization_id = ? AND is_active = 1 ORDER BY priority DESC'
    ).all(organizationId) as any[];
    return rows.map(row => this.mapPolicy(row));
  }

  assignPolicy(policyId: string, agentId: string): void {
    const id = randomUUID();
    this.db.prepare(`
      INSERT OR IGNORE INTO policy_assignments (id, policy_id, agent_id)
      VALUES (?, ?, ?)
    `).run(id, policyId, agentId);
  }

  getAgentPolicies(agentId: string): Policy[] {
    const rows = this.db.prepare(`
      SELECT p.* FROM policies p
      JOIN policy_assignments pa ON p.id = pa.policy_id
      WHERE pa.agent_id = ? AND p.is_active = 1
      ORDER BY p.priority DESC
    `).all(agentId) as any[];
    return rows.map(row => this.mapPolicy(row));
  }

  private mapPolicy(row: any): Policy {
    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      scope: row.scope,
      effect: row.effect,
      priority: row.priority,
      rules: JSON.parse(row.rules || '{}'),
      conditions: JSON.parse(row.conditions || '{}'),
      isActive: Boolean(row.is_active),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Transaction methods
  createTransaction(data: Partial<Transaction>): Transaction {
    const id = data.id || randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO transactions (id, agent_id, organization_id, type, action, amount, currency, status, reason, policy_evaluation, mandate_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.agentId,
      data.organizationId,
      data.type || 'payment',
      data.action || 'execute',
      data.amount || null,
      data.currency || null,
      data.status || 'PENDING',
      data.reason || '',
      JSON.stringify(data.policyEvaluation || {}),
      data.mandateToken || null
    );

    return this.getTransaction(id)!;
  }

  getTransaction(id: string): Transaction | null {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.mapTransaction(row);
  }

  updateTransaction(id: string, data: Partial<Transaction>): Transaction | null {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.mandateToken !== undefined) {
      updates.push('mandate_token = ?');
      values.push(data.mandateToken);
    }
    if (data.policyEvaluation !== undefined) {
      updates.push('policy_evaluation = ?');
      values.push(JSON.stringify(data.policyEvaluation));
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      values.push(id);
      this.db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.getTransaction(id);
  }

  listTransactions(agentId: string, limit = 50): Transaction[] {
    const rows = this.db.prepare(
      'SELECT * FROM transactions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as any[];
    return rows.map(row => this.mapTransaction(row));
  }

  private mapTransaction(row: any): Transaction {
    return {
      id: row.id,
      agentId: row.agent_id,
      organizationId: row.organization_id,
      type: row.type,
      action: row.action,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      policyEvaluation: JSON.parse(row.policy_evaluation || '{}'),
      mandateToken: row.mandate_token,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  // Audit Log methods
  createAuditLog(data: Partial<AuditLog>): AuditLog {
    const id = data.id || randomUUID();
    
    // Get previous hash for chain
    const lastLog = this.db.prepare(
      'SELECT entry_hash FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(data.organizationId) as any;
    
    const previousHash = lastLog?.entry_hash || null;
    
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (id, organization_id, agent_id, action, resource, resource_id, payload, entry_hash, previous_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      data.organizationId,
      data.agentId || null,
      data.action || 'unknown',
      data.resource || 'unknown',
      data.resourceId || null,
      JSON.stringify(data.payload || {}),
      data.entryHash || randomUUID(),
      previousHash
    );

    return this.getAuditLog(id)!;
  }

  getAuditLog(id: string): AuditLog | null {
    const row = this.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id,
      organizationId: row.organization_id,
      agentId: row.agent_id,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      payload: JSON.parse(row.payload || '{}'),
      entryHash: row.entry_hash,
      previousHash: row.previous_hash,
      createdAt: new Date(row.created_at)
    };
  }

  listAuditLogs(organizationId: string, limit = 100): AuditLog[] {
    const rows = this.db.prepare(
      'SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(organizationId, limit) as any[];
    
    return rows.map(row => ({
      id: row.id,
      organizationId: row.organization_id,
      agentId: row.agent_id,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id,
      payload: JSON.parse(row.payload || '{}'),
      entryHash: row.entry_hash,
      previousHash: row.previous_hash,
      createdAt: new Date(row.created_at)
    }));
  }

  // Utility methods
  close(): void {
    this.db.close();
  }

  reset(): void {
    this.db.exec(`
      DELETE FROM audit_logs;
      DELETE FROM delegation_tokens;
      DELETE FROM transactions;
      DELETE FROM policy_assignments;
      DELETE FROM policies;
      DELETE FROM agents;
      DELETE FROM organizations;
    `);
  }

  getStats(): { agents: number; policies: number; transactions: number; auditLogs: number } {
    const agents = (this.db.prepare('SELECT COUNT(*) as count FROM agents').get() as any).count;
    const policies = (this.db.prepare('SELECT COUNT(*) as count FROM policies').get() as any).count;
    const transactions = (this.db.prepare('SELECT COUNT(*) as count FROM transactions').get() as any).count;
    const auditLogs = (this.db.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as any).count;
    
    return { agents, policies, transactions, auditLogs };
  }
}

export default SqliteAdapter;
