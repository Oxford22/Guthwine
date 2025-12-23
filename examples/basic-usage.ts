/**
 * Guthwine - Basic Usage Example
 * 
 * This example demonstrates the core functionality of Guthwine:
 * 1. Registering agents
 * 2. Setting up policies
 * 3. Issuing delegations
 * 4. Authorizing transactions
 */

import { GuthwineService, PolicyEngine } from '../src/index.js';

async function main() {
  // Initialize Guthwine
  const guthwine = new GuthwineService({
    enableSemanticFirewall: true,
    enableRateLimiting: true,
    enableSemanticPolicyCheck: true,
    rateLimitConfig: {
      windowSizeMs: 60000,    // 1 minute window
      maxAmount: 1000,        // $1000 per minute
      maxTransactions: 20,    // 20 transactions per minute
    },
  });

  await guthwine.initialize();
  console.log('✅ Guthwine initialized\n');

  // ============================================================================
  // 1. Register Agents
  // ============================================================================
  console.log('📋 Registering agents...');

  // Register a parent agent (e.g., a user's primary AI assistant)
  const parentAgent = await guthwine.registerAgent({
    name: 'Personal Finance Assistant',
    description: 'Main AI assistant for financial tasks',
  });
  console.log(`   Parent Agent DID: ${parentAgent.did}`);

  // Register a child agent (e.g., a specialized shopping agent)
  const shoppingAgent = await guthwine.registerAgent({
    name: 'Shopping Agent',
    description: 'Specialized agent for e-commerce purchases',
    ownerDid: parentAgent.did,
  });
  console.log(`   Shopping Agent DID: ${shoppingAgent.did}\n`);

  // ============================================================================
  // 2. Set Up Policies
  // ============================================================================
  console.log('📜 Setting up policies...');

  // Policy 1: Maximum transaction amount
  await guthwine.addPolicy(
    parentAgent.did,
    'Max Transaction $500',
    PolicyEngine.POLICY_TEMPLATES.maxAmount(500),
    { description: 'Limit individual transactions to $500' }
  );
  console.log('   ✓ Added max amount policy ($500)');

  // Policy 2: Only USD transactions
  await guthwine.addPolicy(
    parentAgent.did,
    'USD Only',
    PolicyEngine.POLICY_TEMPLATES.allowedCurrencies(['USD']),
    { description: 'Only allow USD transactions' }
  );
  console.log('   ✓ Added USD-only policy');

  // Policy 3: Block gambling merchants
  await guthwine.addPolicy(
    parentAgent.did,
    'No Gambling',
    PolicyEngine.POLICY_TEMPLATES.blockedMerchants(['casino_123', 'betting_456']),
    { description: 'Block gambling-related merchants' }
  );
  console.log('   ✓ Added gambling block policy');

  // Policy 4: Semantic constraint (evaluated by LLM)
  await guthwine.addPolicy(
    parentAgent.did,
    'Business Purchases Only',
    { '==': [1, 1] }, // Always passes JSON Logic, semantic check does the work
    {
      description: 'Only allow business-related purchases',
      semanticConstraints: 'Only allow purchases that are clearly business-related, such as office supplies, software, or professional services. Block personal entertainment or luxury items.',
    }
  );
  console.log('   ✓ Added semantic policy (business purchases only)\n');

  // ============================================================================
  // 3. Issue Delegation
  // ============================================================================
  console.log('🔗 Issuing delegation to shopping agent...');

  const delegation = await guthwine.issueDelegation(
    parentAgent.did,
    shoppingAgent.did,
    {
      maxAmount: 200,                              // Lower limit than parent
      currency: 'USD',
      allowedCategories: ['office', 'software'],  // Restricted categories
      semanticConstraints: 'Only sustainable products from verified sellers',
      expiresIn: 3600,                            // 1 hour expiry
    }
  );
  console.log(`   Delegation Token Hash: ${delegation.tokenHash}\n`);

  // ============================================================================
  // 4. Authorize Transactions
  // ============================================================================
  console.log('💳 Testing transaction authorization...\n');

  // Test 1: Valid transaction (should ALLOW)
  console.log('Test 1: Valid transaction');
  const result1 = await guthwine.requestTransactionSignature(
    parentAgent.did,
    {
      amount: 150,
      currency: 'USD',
      merchantId: 'office_depot_001',
      merchantName: 'Office Depot',
      merchantCategory: 'office',
      reasoningTrace: 'Purchasing printer paper and pens for the office',
    }
  );
  console.log(`   Decision: ${result1.decision}`);
  console.log(`   Reason: ${result1.reason}`);
  if (result1.mandate) {
    console.log(`   Mandate: ${result1.mandate.substring(0, 50)}...`);
  }
  console.log();

  // Test 2: Transaction exceeding limit (should DENY)
  console.log('Test 2: Transaction exceeding limit');
  const result2 = await guthwine.requestTransactionSignature(
    parentAgent.did,
    {
      amount: 1000,
      currency: 'USD',
      merchantId: 'amazon_001',
      merchantName: 'Amazon',
      reasoningTrace: 'Buying a new laptop',
    }
  );
  console.log(`   Decision: ${result2.decision}`);
  console.log(`   Violations: ${result2.policyViolations?.join(', ')}`);
  console.log();

  // Test 3: Delegated transaction (should ALLOW)
  console.log('Test 3: Delegated transaction');
  
  // First add a policy for the shopping agent
  await guthwine.addPolicy(
    shoppingAgent.did,
    'Allow All',
    { '==': [1, 1] },
    { description: 'Base policy' }
  );

  const result3 = await guthwine.requestTransactionSignature(
    shoppingAgent.did,
    {
      amount: 75,
      currency: 'USD',
      merchantId: 'staples_001',
      merchantName: 'Staples',
      merchantCategory: 'office',
      reasoningTrace: 'Purchasing sustainable notebooks from verified seller',
    },
    [delegation.token]
  );
  console.log(`   Decision: ${result3.decision}`);
  console.log(`   Reason: ${result3.reason}`);
  console.log();

  // Test 4: Delegated transaction exceeding delegation limit (should DENY)
  console.log('Test 4: Delegated transaction exceeding delegation limit');
  const result4 = await guthwine.requestTransactionSignature(
    shoppingAgent.did,
    {
      amount: 300, // Exceeds delegation limit of $200
      currency: 'USD',
      merchantId: 'staples_001',
      merchantName: 'Staples',
      merchantCategory: 'office',
      reasoningTrace: 'Large office supply order',
    },
    [delegation.token]
  );
  console.log(`   Decision: ${result4.decision}`);
  console.log(`   Violations: ${result4.policyViolations?.join(', ')}`);
  console.log();

  // ============================================================================
  // 5. Kill Switch Demo
  // ============================================================================
  console.log('🛑 Kill Switch Demo...');

  // Freeze the shopping agent
  await guthwine.freezeAgent(shoppingAgent.did, 'Suspicious activity detected');
  console.log('   ✓ Shopping agent frozen');

  // Try to transact with frozen agent
  const result5 = await guthwine.requestTransactionSignature(
    shoppingAgent.did,
    {
      amount: 50,
      currency: 'USD',
      merchantId: 'amazon_001',
      reasoningTrace: 'Test purchase',
    }
  );
  console.log(`   Transaction attempt: ${result5.decision}`);

  // Unfreeze
  await guthwine.unfreezeAgent(shoppingAgent.did);
  console.log('   ✓ Shopping agent unfrozen\n');

  // ============================================================================
  // 6. Audit Trail
  // ============================================================================
  console.log('📊 Audit Trail...');

  const auditTrail = await guthwine.getAuditTrail({
    agentDid: parentAgent.did,
    limit: 5,
  });
  console.log(`   Total entries for parent agent: ${auditTrail.total}`);
  console.log('   Recent entries:');
  for (const entry of auditTrail.entries.slice(0, 3)) {
    console.log(`     - ${entry.action}: ${entry.decision} (${entry.amount ? '$' + entry.amount : 'N/A'})`);
  }

  // Verify integrity
  const integrity = await guthwine.verifyAuditIntegrity();
  console.log(`\n   Audit integrity: ${integrity.valid ? '✅ Valid' : '❌ Compromised'}`);
  console.log(`   Entries verified: ${integrity.entriesChecked}\n`);

  // ============================================================================
  // Cleanup
  // ============================================================================
  await guthwine.shutdown();
  console.log('✅ Example complete!');
}

main().catch(console.error);
