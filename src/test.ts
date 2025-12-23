/**
 * Guthwine - Test Suite
 * Comprehensive tests for the Sovereign Governance Layer
 */

import { GuthwineService } from './services/GuthwineService.js';
import { PolicyEngine } from './services/PolicyEngine.js';

async function runTests(): Promise<void> {
  console.log('🔐 Guthwine Test Suite\n');
  console.log('='.repeat(60));

  const guthwine = new GuthwineService({
    enableSemanticFirewall: false, // Disable for faster tests
    enableRateLimiting: true,
    enableSemanticPolicyCheck: false,
    rateLimitConfig: {
      windowSizeMs: 60000,
      maxAmount: 10000, // High limit for testing
      maxTransactions: 100,
    },
  });

  await guthwine.initialize();

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  // ============================================================================
  // Agent Registration Tests
  // ============================================================================
  console.log('\n📋 Agent Registration Tests');
  console.log('-'.repeat(40));

  let testAgent: any;
  let testAgent2: any;

  await test('Register new agent', async () => {
    testAgent = await guthwine.registerAgent({
      name: 'Test Agent Alpha',
      description: 'A test agent for validation',
    });
    if (!testAgent.did.startsWith('did:guthwine:')) {
      throw new Error('Invalid DID format');
    }
  });

  await test('Register child agent', async () => {
    testAgent2 = await guthwine.registerAgent({
      name: 'Test Agent Beta',
      description: 'A child agent',
      ownerDid: testAgent.did,
    });
    if (testAgent2.ownerDid !== testAgent.did) {
      throw new Error('Owner DID not set correctly');
    }
  });

  await test('Get agent by DID', async () => {
    const agent = await guthwine.getAgent(testAgent.did);
    if (!agent || agent.name !== 'Test Agent Alpha') {
      throw new Error('Agent not found or name mismatch');
    }
  });

  // ============================================================================
  // Policy Tests
  // ============================================================================
  console.log('\n📜 Policy Tests');
  console.log('-'.repeat(40));

  await test('Add max amount policy', async () => {
    const policyId = await guthwine.addPolicy(
      testAgent.did,
      'Max Amount $500',
      PolicyEngine.POLICY_TEMPLATES.maxAmount(500),
      { description: 'Limit transactions to $500' }
    );
    if (!policyId) {
      throw new Error('Policy ID not returned');
    }
  });

  await test('Add allowed currencies policy', async () => {
    await guthwine.addPolicy(
      testAgent.did,
      'USD Only',
      PolicyEngine.POLICY_TEMPLATES.allowedCurrencies(['USD']),
      { description: 'Only allow USD transactions' }
    );
  });

  await test('Get policies for agent', async () => {
    const policies = await guthwine.getPolicies(testAgent.did);
    if (policies.length !== 2) {
      throw new Error(`Expected 2 policies, got ${policies.length}`);
    }
  });

  // ============================================================================
  // Transaction Authorization Tests
  // ============================================================================
  console.log('\n💳 Transaction Authorization Tests');
  console.log('-'.repeat(40));

  await test('Approve valid transaction', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 100,
      currency: 'USD',
      merchantId: 'merchant_001',
      merchantName: 'Test Store',
      reasoningTrace: 'Purchasing office supplies for the team',
    });
    if (result.decision !== 'ALLOW') {
      throw new Error(`Expected ALLOW, got ${result.decision}: ${result.reason}`);
    }
    if (!result.mandate) {
      throw new Error('No mandate returned');
    }
  });

  await test('Deny transaction exceeding limit', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 1000,
      currency: 'USD',
      merchantId: 'merchant_001',
      reasoningTrace: 'Large purchase',
    });
    if (result.decision !== 'DENY') {
      throw new Error(`Expected DENY, got ${result.decision}`);
    }
  });

  await test('Deny transaction with wrong currency', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 100,
      currency: 'EUR',
      merchantId: 'merchant_001',
      reasoningTrace: 'European purchase',
    });
    if (result.decision !== 'DENY') {
      throw new Error(`Expected DENY, got ${result.decision}`);
    }
  });

  // ============================================================================
  // Delegation Tests
  // ============================================================================
  console.log('\n🔗 Delegation Tests');
  console.log('-'.repeat(40));

  let delegationToken: string;
  let delegationHash: string;

  await test('Issue delegation token', async () => {
    const result = await guthwine.issueDelegation(testAgent.did, testAgent2.did, {
      maxAmount: 200,
      currency: 'USD',
      expiresIn: 3600,
    });
    delegationToken = result.token;
    delegationHash = result.tokenHash;
    if (!delegationToken || !delegationHash) {
      throw new Error('Delegation token not issued');
    }
  });

  await test('Add policy for delegated agent', async () => {
    await guthwine.addPolicy(
      testAgent2.did,
      'Allow All',
      { '==': [1, 1] }, // Always true
      { description: 'Allow all transactions' }
    );
  });

  await test('Use delegation for transaction', async () => {
    const result = await guthwine.requestTransactionSignature(
      testAgent2.did,
      {
        amount: 150,
        currency: 'USD',
        merchantId: 'merchant_002',
        reasoningTrace: 'Delegated purchase',
      },
      [delegationToken]
    );
    if (result.decision !== 'ALLOW') {
      throw new Error(`Expected ALLOW, got ${result.decision}: ${result.reason}`);
    }
  });

  await test('Deny delegation exceeding constraints', async () => {
    const result = await guthwine.requestTransactionSignature(
      testAgent2.did,
      {
        amount: 300, // Exceeds delegation limit of 200
        currency: 'USD',
        merchantId: 'merchant_002',
        reasoningTrace: 'Large delegated purchase',
      },
      [delegationToken]
    );
    if (result.decision !== 'DENY') {
      throw new Error(`Expected DENY, got ${result.decision}`);
    }
  });

  await test('Revoke delegation', async () => {
    const success = await guthwine.revokeDelegation(delegationHash, 'Test revocation');
    if (!success) {
      throw new Error('Failed to revoke delegation');
    }
  });

  await test('Deny transaction with revoked delegation', async () => {
    const result = await guthwine.requestTransactionSignature(
      testAgent2.did,
      {
        amount: 50,
        currency: 'USD',
        merchantId: 'merchant_002',
        reasoningTrace: 'Post-revocation purchase',
      },
      [delegationToken]
    );
    if (result.decision !== 'DENY') {
      throw new Error(`Expected DENY, got ${result.decision}`);
    }
  });

  // ============================================================================
  // Kill Switch Tests
  // ============================================================================
  console.log('\n🛑 Kill Switch Tests');
  console.log('-'.repeat(40));

  await test('Freeze agent', async () => {
    const success = await guthwine.freezeAgent(testAgent.did, 'Test freeze');
    if (!success) {
      throw new Error('Failed to freeze agent');
    }
  });

  await test('Deny transaction for frozen agent', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 50,
      currency: 'USD',
      merchantId: 'merchant_001',
      reasoningTrace: 'Frozen agent transaction',
    });
    if (result.decision !== 'FROZEN') {
      throw new Error(`Expected FROZEN, got ${result.decision}`);
    }
  });

  await test('Unfreeze agent', async () => {
    const success = await guthwine.unfreezeAgent(testAgent.did);
    if (!success) {
      throw new Error('Failed to unfreeze agent');
    }
  });

  await test('Allow transaction after unfreeze', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 50,
      currency: 'USD',
      merchantId: 'merchant_001',
      reasoningTrace: 'Post-unfreeze transaction',
    });
    if (result.decision !== 'ALLOW') {
      throw new Error(`Expected ALLOW, got ${result.decision}: ${result.reason}`);
    }
  });

  // ============================================================================
  // Rate Limiting Tests
  // ============================================================================
  console.log('\n⏱️ Rate Limiting Tests');
  console.log('-'.repeat(40));

  await test('Get rate limit status', async () => {
    const status = await guthwine.getRateLimiter().getStatus(testAgent.did);
    if (status.currentSpend === undefined) {
      throw new Error('Rate limit status not returned');
    }
  });

  await test('Record transactions in rate limiter', async () => {
    // Make multiple transactions
    for (let i = 0; i < 3; i++) {
      await guthwine.requestTransactionSignature(testAgent.did, {
        amount: 15,
        currency: 'USD',
        merchantId: 'merchant_001',
        reasoningTrace: `Rate limit test ${i}`,
      });
    }
    
    const status = await guthwine.getRateLimiter().getStatus(testAgent.did);
    if (status.transactionCount === 0) {
      throw new Error('Transactions not recorded in rate limiter');
    }
  });

  // ============================================================================
  // Audit Trail Tests
  // ============================================================================
  console.log('\n📊 Audit Trail Tests');
  console.log('-'.repeat(40));

  await test('Get audit trail', async () => {
    const result = await guthwine.getAuditTrail({
      agentDid: testAgent.did,
      limit: 10,
    });
    if (!result.entries || result.entries.length === 0) {
      throw new Error('No audit entries found');
    }
  });

  await test('Verify audit integrity', async () => {
    const result = await guthwine.verifyAuditIntegrity();
    if (!result.valid) {
      throw new Error(`Audit integrity check failed: ${result.errors.slice(0, 3).join(', ')}`);
    }
  });

  // ============================================================================
  // Global Freeze Tests
  // ============================================================================
  console.log('\n🌐 Global Freeze Tests');
  console.log('-'.repeat(40));

  await test('Set global freeze', async () => {
    await guthwine.getIdentityService().setGlobalFreeze(true);
    const frozen = await guthwine.getIdentityService().isGlobalFreezeActive();
    if (!frozen) {
      throw new Error('Global freeze not set');
    }
  });

  await test('Deny all transactions during global freeze', async () => {
    const result = await guthwine.requestTransactionSignature(testAgent.did, {
      amount: 10,
      currency: 'USD',
      merchantId: 'merchant_001',
      reasoningTrace: 'Global freeze test',
    });
    if (result.decision !== 'FROZEN') {
      throw new Error(`Expected FROZEN, got ${result.decision}`);
    }
  });

  await test('Disable global freeze', async () => {
    await guthwine.getIdentityService().setGlobalFreeze(false);
    const frozen = await guthwine.getIdentityService().isGlobalFreezeActive();
    if (frozen) {
      throw new Error('Global freeze not disabled');
    }
  });

  // ============================================================================
  // Vault Tests
  // ============================================================================
  console.log('\n🔒 Vault Tests');
  console.log('-'.repeat(40));

  await test('Store and retrieve secret', async () => {
    const testSecret = 'sk_test_secret_key_12345';
    await guthwine.storeSecret('test_api_key', testSecret);
    const retrieved = await guthwine.getSecret('test_api_key');
    if (retrieved !== testSecret) {
      throw new Error('Secret mismatch');
    }
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed!\n');
  } else {
    console.log('\n⚠️ Some tests failed. Please review the errors above.\n');
  }

  await guthwine.shutdown();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});
