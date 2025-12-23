/**
 * Guthwine Database Seed Script
 * 
 * Creates 3 test organizations with 10 agents each and realistic policies.
 * 
 * Usage: npx ts-node prisma/seed/index.ts
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

// =============================================================================
// HELPERS
// =============================================================================

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function generateDid(): string {
  return `did:guthwine:${crypto.randomBytes(16).toString('hex')}`;
}

function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function generateEncryptionSalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = `gw_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 10);
  return { key, hash, prefix };
}

// =============================================================================
// SEED DATA
// =============================================================================

const ORGANIZATIONS = [
  {
    name: 'Acme Corporation',
    slug: 'acme-corp',
    tier: 'ENTERPRISE' as const,
    usageLimits: {
      maxAgents: 100,
      maxPolicies: 500,
      maxApiCalls: 1000000,
      maxSemanticEvals: 10000,
    },
  },
  {
    name: 'TechStart Inc',
    slug: 'techstart',
    tier: 'PROFESSIONAL' as const,
    usageLimits: {
      maxAgents: 25,
      maxPolicies: 100,
      maxApiCalls: 100000,
      maxSemanticEvals: 1000,
    },
  },
  {
    name: 'Demo Organization',
    slug: 'demo-org',
    tier: 'FREE' as const,
    usageLimits: {
      maxAgents: 5,
      maxPolicies: 10,
      maxApiCalls: 10000,
      maxSemanticEvals: 100,
    },
  },
];

const AGENT_TEMPLATES = [
  { name: 'Shopping Assistant', type: 'PRIMARY' as const, capabilities: { canPurchase: true, canBrowse: true } },
  { name: 'Travel Booking Agent', type: 'PRIMARY' as const, capabilities: { canBook: true, canSearch: true } },
  { name: 'Expense Manager', type: 'PRIMARY' as const, capabilities: { canSubmit: true, canApprove: false } },
  { name: 'Research Agent', type: 'PRIMARY' as const, capabilities: { canSearch: true, canSummarize: true } },
  { name: 'Customer Support Bot', type: 'SERVICE' as const, capabilities: { canRespond: true, canEscalate: true } },
  { name: 'Data Analyst', type: 'PRIMARY' as const, capabilities: { canQuery: true, canVisualize: true } },
  { name: 'Content Writer', type: 'PRIMARY' as const, capabilities: { canWrite: true, canEdit: true } },
  { name: 'Meeting Scheduler', type: 'SERVICE' as const, capabilities: { canSchedule: true, canCancel: true } },
  { name: 'Invoice Processor', type: 'PRIMARY' as const, capabilities: { canProcess: true, canApprove: false } },
  { name: 'Inventory Manager', type: 'SERVICE' as const, capabilities: { canOrder: true, canTrack: true } },
];

const POLICY_TEMPLATES = [
  {
    name: 'Daily Spending Limit',
    description: 'Limits daily spending to $500',
    type: 'SPENDING' as const,
    rules: { '<=': [{ var: 'totalSpent.daily' }, 500] },
    action: 'DENY' as const,
    priority: 100,
  },
  {
    name: 'Weekly Spending Limit',
    description: 'Limits weekly spending to $2000',
    type: 'SPENDING' as const,
    rules: { '<=': [{ var: 'totalSpent.weekly' }, 2000] },
    action: 'DENY' as const,
    priority: 90,
  },
  {
    name: 'Monthly Spending Limit',
    description: 'Limits monthly spending to $10000',
    type: 'SPENDING' as const,
    rules: { '<=': [{ var: 'totalSpent.monthly' }, 10000] },
    action: 'DENY' as const,
    priority: 80,
  },
  {
    name: 'Single Transaction Limit',
    description: 'Maximum $1000 per transaction',
    type: 'SPENDING' as const,
    rules: { '<=': [{ var: 'amount' }, 1000] },
    action: 'DENY' as const,
    priority: 110,
  },
  {
    name: 'Business Hours Only',
    description: 'Only allow transactions during business hours (9 AM - 6 PM)',
    type: 'TEMPORAL' as const,
    rules: {
      and: [
        { '>=': [{ var: 'hour' }, 9] },
        { '<=': [{ var: 'hour' }, 18] },
        { in: [{ var: 'dayOfWeek' }, [1, 2, 3, 4, 5]] },
      ],
    },
    action: 'DENY' as const,
    priority: 70,
  },
  {
    name: 'Approved Vendors Only',
    description: 'Only allow transactions with approved vendors',
    type: 'VENDOR' as const,
    rules: {
      in: [
        { var: 'merchantCategory' },
        ['retail', 'software', 'office_supplies', 'travel', 'food'],
      ],
    },
    action: 'DENY' as const,
    priority: 60,
  },
  {
    name: 'Block High-Risk Merchants',
    description: 'Block transactions with high-risk merchant categories',
    type: 'VENDOR' as const,
    rules: {
      '!': {
        in: [
          { var: 'merchantCategory' },
          ['gambling', 'cryptocurrency', 'adult', 'weapons'],
        ],
      },
    },
    action: 'DENY' as const,
    priority: 120,
  },
  {
    name: 'Require Approval Above $500',
    description: 'Flag transactions above $500 for human review',
    type: 'SPENDING' as const,
    rules: { '>': [{ var: 'amount' }, 500] },
    action: 'FLAG' as const,
    priority: 50,
  },
  {
    name: 'Rate Limit - 10 per hour',
    description: 'Maximum 10 transactions per hour per agent',
    type: 'RATE_LIMIT' as const,
    rules: { '<=': [{ var: 'transactionsLastHour' }, 10] },
    action: 'DENY' as const,
    priority: 130,
  },
  {
    name: 'Geographic Restriction - US Only',
    description: 'Only allow transactions from US merchants',
    type: 'GEOGRAPHIC' as const,
    rules: { in: [{ var: 'merchantCountry' }, ['US', 'USA']] },
    action: 'DENY' as const,
    priority: 40,
  },
];

// =============================================================================
// MAIN SEED FUNCTION
// =============================================================================

async function main() {
  console.log('🌱 Starting Guthwine database seed...\n');

  // Clear existing data
  console.log('🗑️  Clearing existing data...');
  await prisma.auditLog.deleteMany();
  await prisma.transactionReconciliation.deleteMany();
  await prisma.transactionRequest.deleteMany();
  await prisma.delegationToken.deleteMany();
  await prisma.policyAssignment.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.aPIKey.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.globalFreeze.deleteMany();
  await prisma.systemConfig.deleteMany();

  // Create global freeze record
  console.log('⚙️  Creating system config...');
  await prisma.globalFreeze.create({
    data: {
      isActive: false,
    },
  });

  // Create organizations
  console.log('\n🏢 Creating organizations...');
  const orgs: any[] = [];

  for (const orgTemplate of ORGANIZATIONS) {
    const org = await prisma.organization.create({
      data: {
        name: orgTemplate.name,
        slug: orgTemplate.slug,
        tier: orgTemplate.tier,
        usageLimits: orgTemplate.usageLimits,
        encryptionKeySalt: generateEncryptionSalt(),
        status: 'ACTIVE',
        verifiedAt: new Date(),
        settings: {
          defaultCurrency: 'USD',
          timezone: 'America/New_York',
          notifications: {
            email: true,
            slack: false,
          },
        },
        metadata: {
          industry: 'Technology',
          size: 'Medium',
        },
      },
    });
    orgs.push(org);
    console.log(`  ✅ Created org: ${org.name} (${org.id})`);
  }

  // Create users for each organization
  console.log('\n👥 Creating users...');
  const users: any[] = [];

  for (const org of orgs) {
    // Create owner
    const owner = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `owner@${org.slug}.com`,
        name: `${org.name} Owner`,
        passwordHash: hashPassword('password123'),
        role: 'OWNER',
        status: 'ACTIVE',
        preferences: { theme: 'dark', language: 'en' },
      },
    });
    users.push(owner);
    console.log(`  ✅ Created owner: ${owner.email}`);

    // Create admin
    const admin = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `admin@${org.slug}.com`,
        name: `${org.name} Admin`,
        passwordHash: hashPassword('password123'),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    users.push(admin);
    console.log(`  ✅ Created admin: ${admin.email}`);

    // Create policy manager
    const policyManager = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `policy@${org.slug}.com`,
        name: `${org.name} Policy Manager`,
        passwordHash: hashPassword('password123'),
        role: 'POLICY_MANAGER',
        status: 'ACTIVE',
      },
    });
    users.push(policyManager);
    console.log(`  ✅ Created policy manager: ${policyManager.email}`);

    // Create agent operator
    const operator = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `operator@${org.slug}.com`,
        name: `${org.name} Operator`,
        passwordHash: hashPassword('password123'),
        role: 'AGENT_OPERATOR',
        status: 'ACTIVE',
      },
    });
    users.push(operator);
    console.log(`  ✅ Created operator: ${operator.email}`);

    // Create auditor
    const auditor = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: `auditor@${org.slug}.com`,
        name: `${org.name} Auditor`,
        passwordHash: hashPassword('password123'),
        role: 'AUDITOR',
        status: 'ACTIVE',
      },
    });
    users.push(auditor);
    console.log(`  ✅ Created auditor: ${auditor.email}`);
  }

  // Create API keys for each organization
  console.log('\n🔑 Creating API keys...');
  const apiKeys: { org: string; key: string }[] = [];

  for (let i = 0; i < orgs.length; i++) {
    const org = orgs[i];
    const owner = users.find(u => u.organizationId === org.id && u.role === 'OWNER');
    
    const { key, hash, prefix } = generateApiKey();
    await prisma.aPIKey.create({
      data: {
        organizationId: org.id,
        createdById: owner.id,
        name: 'Default API Key',
        keyHash: hash,
        keyPrefix: prefix,
        scopes: ['READ', 'WRITE'],
        permissions: [],
        isActive: true,
      },
    });
    apiKeys.push({ org: org.slug, key });
    console.log(`  ✅ Created API key for ${org.name}: ${prefix}...`);
  }

  // Create agents for each organization
  console.log('\n🤖 Creating agents...');
  const agents: any[] = [];

  for (const org of orgs) {
    const owner = users.find(u => u.organizationId === org.id && u.role === 'OWNER');

    for (const agentTemplate of AGENT_TEMPLATES) {
      const keyPair = generateKeyPair();
      const agent = await prisma.agent.create({
        data: {
          organizationId: org.id,
          did: generateDid(),
          name: agentTemplate.name,
          publicKey: keyPair.publicKey,
          encryptedPrivateKey: keyPair.privateKey, // In production, this would be encrypted
          createdByUserId: owner.id,
          type: agentTemplate.type,
          status: 'ACTIVE',
          capabilities: agentTemplate.capabilities,
          spendingLimits: {
            daily: 500,
            weekly: 2000,
            monthly: 10000,
            perTransaction: 1000,
          },
          metadata: {
            version: '1.0.0',
            environment: 'production',
          },
          reputationScore: 100,
        },
      });
      agents.push(agent);
    }
    console.log(`  ✅ Created 10 agents for ${org.name}`);
  }

  // Create policies for each organization
  console.log('\n📜 Creating policies...');
  const policies: any[] = [];

  for (const org of orgs) {
    const owner = users.find(u => u.organizationId === org.id && u.role === 'OWNER');

    for (const policyTemplate of POLICY_TEMPLATES) {
      const policy = await prisma.policy.create({
        data: {
          organizationId: org.id,
          name: policyTemplate.name,
          description: policyTemplate.description,
          type: policyTemplate.type,
          scope: 'ORGANIZATION',
          rules: policyTemplate.rules,
          action: policyTemplate.action,
          priority: policyTemplate.priority,
          isActive: true,
          isSystem: false,
          version: 1,
          createdById: owner.id,
          metadata: {},
        },
      });
      policies.push(policy);
    }
    console.log(`  ✅ Created ${POLICY_TEMPLATES.length} policies for ${org.name}`);
  }

  // Assign policies to agents
  console.log('\n🔗 Assigning policies to agents...');
  for (const org of orgs) {
    const orgAgents = agents.filter(a => a.organizationId === org.id);
    const orgPolicies = policies.filter(p => p.organizationId === org.id);
    const owner = users.find(u => u.organizationId === org.id && u.role === 'OWNER');

    // Assign all policies to all agents
    for (const agent of orgAgents) {
      for (const policy of orgPolicies) {
        await prisma.policyAssignment.create({
          data: {
            policyId: policy.id,
            agentId: agent.id,
            assignedById: owner.id,
          },
        });
      }
    }
    console.log(`  ✅ Assigned policies to agents for ${org.name}`);
  }

  // Create some sample transactions
  console.log('\n💳 Creating sample transactions...');
  for (const org of orgs) {
    const orgAgents = agents.filter(a => a.organizationId === org.id);
    
    for (let i = 0; i < 5; i++) {
      const agent = orgAgents[Math.floor(Math.random() * orgAgents.length)];
      const amount = Math.floor(Math.random() * 500) + 10;
      const status = ['APPROVED', 'DENIED', 'EXECUTED'][Math.floor(Math.random() * 3)] as any;
      
      await prisma.transactionRequest.create({
        data: {
          organizationId: org.id,
          agentId: agent.id,
          agentDid: agent.did,
          type: 'PAYMENT',
          amount,
          currency: 'USD',
          merchant: {
            id: `merchant-${i}`,
            name: ['Amazon', 'Stripe', 'Google Cloud', 'AWS', 'Shopify'][i],
            category: 'software',
            country: 'US',
          },
          description: `Sample transaction ${i + 1}`,
          reasoningTrace: 'User requested purchase for business operations',
          status,
          riskScore: Math.floor(Math.random() * 30),
          policyEvaluation: {
            policiesEvaluated: 10,
            passed: status !== 'DENIED' ? 10 : 8,
            failed: status !== 'DENIED' ? 0 : 2,
          },
          decidedAt: new Date(),
          executedAt: status === 'EXECUTED' ? new Date() : null,
        },
      });
    }
    console.log(`  ✅ Created 5 sample transactions for ${org.name}`);
  }

  // Create audit logs
  console.log('\n📝 Creating audit logs...');
  for (const org of orgs) {
    const owner = users.find(u => u.organizationId === org.id && u.role === 'OWNER');
    
    const actions = [
      { action: 'organization.created', severity: 'INFO' as const },
      { action: 'user.created', severity: 'INFO' as const },
      { action: 'agent.created', severity: 'INFO' as const },
      { action: 'policy.created', severity: 'INFO' as const },
      { action: 'transaction.authorized', severity: 'INFO' as const },
    ];

    let previousHash = '';
    for (let i = 0; i < actions.length; i++) {
      const entryData = JSON.stringify({
        action: actions[i].action,
        timestamp: new Date().toISOString(),
        sequenceNumber: i + 1,
      });
      const entryHash = crypto.createHash('sha256').update(previousHash + entryData).digest('hex');
      
      await prisma.auditLog.create({
        data: {
          organizationId: org.id,
          sequenceNumber: i + 1,
          action: actions[i].action,
          severity: actions[i].severity,
          actorType: 'USER',
          actorId: owner.id,
          payload: { details: `${actions[i].action} event` },
          previousHash: previousHash || null,
          entryHash,
          signature: crypto.createHash('sha256').update(entryHash + 'secret').digest('hex'),
          retainUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        },
      });
      previousHash = entryHash;
    }
    console.log(`  ✅ Created ${actions.length} audit logs for ${org.name}`);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Seed completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   Organizations: ${orgs.length}`);
  console.log(`   Users: ${users.length}`);
  console.log(`   Agents: ${agents.length}`);
  console.log(`   Policies: ${policies.length}`);
  console.log('\n🔑 API Keys (save these!):');
  for (const apiKey of apiKeys) {
    console.log(`   ${apiKey.org}: ${apiKey.key}`);
  }
  console.log('\n👤 Test Login Credentials:');
  console.log('   Email: owner@acme-corp.com');
  console.log('   Password: password123');
  console.log('='.repeat(60));
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
