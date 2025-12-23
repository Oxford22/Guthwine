/**
 * Guthwine - HTTP Server
 * REST API for direct integration with the governance layer
 */

import Fastify, { FastifyInstance } from 'fastify';
import { GuthwineService } from './services/GuthwineService.js';
import { PolicyEngine } from './services/PolicyEngine.js';

export async function createHTTPServer(guthwine?: GuthwineService): Promise<FastifyInstance> {
  const service = guthwine || new GuthwineService({
    enableSemanticFirewall: true,
    enableRateLimiting: true,
    enableSemanticPolicyCheck: true,
  });

  await service.initialize();

  const app = Fastify({
    logger: true,
  });

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    service: 'guthwine',
    version: '1.0.0',
  }));

  // ============================================================================
  // Agent Management
  // ============================================================================

  // Register agent
  app.post('/agents', async (request, reply) => {
    const body = request.body as any;
    try {
      const agent = await service.registerAgent({
        name: body.name,
        description: body.description,
        ownerDid: body.owner_did,
      });
      return reply.code(201).send(agent);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to register agent',
      });
    }
  });

  // Get agent
  app.get('/agents/:did', async (request, reply) => {
    const { did } = request.params as any;
    const agent = await service.getAgent(did);
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    const reputation = await service.getIdentityService().getReputationScore(did);
    return { agent, reputation };
  });

  // Freeze agent
  app.post('/agents/:did/freeze', async (request, reply) => {
    const { did } = request.params as any;
    const { reason } = request.body as any;
    const success = await service.freezeAgent(did, reason);
    if (!success) {
      return reply.code(400).send({ error: 'Failed to freeze agent' });
    }
    return { success: true };
  });

  // Unfreeze agent
  app.post('/agents/:did/unfreeze', async (request, reply) => {
    const { did } = request.params as any;
    const success = await service.unfreezeAgent(did);
    if (!success) {
      return reply.code(400).send({ error: 'Failed to unfreeze agent' });
    }
    return { success: true };
  });

  // ============================================================================
  // Transaction Authorization
  // ============================================================================

  // Request transaction signature
  app.post('/transactions/authorize', async (request, reply) => {
    const body = request.body as any;
    try {
      const result = await service.requestTransactionSignature(
        body.agent_did,
        {
          amount: body.amount,
          currency: body.currency || 'USD',
          merchantId: body.merchant_id,
          merchantName: body.merchant_name,
          merchantCategory: body.merchant_category,
          reasoningTrace: body.reasoning_trace,
          metadata: body.metadata,
        },
        body.delegation_chain
      );

      const statusCode = result.decision === 'ALLOW' ? 200 : 
                        result.decision === 'PENDING_HUMAN_APPROVAL' ? 202 : 403;
      return reply.code(statusCode).send(result);
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Authorization failed',
      });
    }
  });

  // ============================================================================
  // Delegation Management
  // ============================================================================

  // Issue delegation
  app.post('/delegations', async (request, reply) => {
    const body = request.body as any;
    try {
      const result = await service.issueDelegation(
        body.issuer_did,
        body.recipient_did,
        {
          maxAmount: body.max_amount,
          currency: body.currency,
          allowedMerchants: body.allowed_merchants,
          allowedCategories: body.allowed_categories,
          semanticConstraints: body.semantic_constraints,
          expiresIn: body.expires_in_seconds || 3600,
        }
      );
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to issue delegation',
      });
    }
  });

  // Revoke delegation
  app.delete('/delegations/:tokenHash', async (request, reply) => {
    const { tokenHash } = request.params as any;
    const { reason } = request.body as any;
    const success = await service.revokeDelegation(tokenHash, reason);
    if (!success) {
      return reply.code(400).send({ error: 'Failed to revoke delegation' });
    }
    return { success: true };
  });

  // Get active delegations for agent
  app.get('/agents/:did/delegations', async (request, reply) => {
    const { did } = request.params as any;
    const delegations = await service.getDelegationService().getActiveDelegations(did);
    return delegations;
  });

  // ============================================================================
  // Policy Management
  // ============================================================================

  // Add policy
  app.post('/agents/:did/policies', async (request, reply) => {
    const { did } = request.params as any;
    const body = request.body as any;
    try {
      const policyId = await service.addPolicy(did, body.name, body.rules, {
        description: body.description,
        semanticConstraints: body.semantic_constraints,
        priority: body.priority,
      });
      return reply.code(201).send({ policyId });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to add policy',
      });
    }
  });

  // Get policies
  app.get('/agents/:did/policies', async (request, reply) => {
    const { did } = request.params as any;
    const policies = await service.getPolicies(did);
    return { policies };
  });

  // Get policy templates
  app.get('/policies/templates', async () => {
    return {
      templates: {
        maxAmount: {
          description: 'Limit maximum transaction amount',
          example: PolicyEngine.POLICY_TEMPLATES.maxAmount(500),
        },
        allowedCurrencies: {
          description: 'Restrict to specific currencies',
          example: PolicyEngine.POLICY_TEMPLATES.allowedCurrencies(['USD', 'EUR']),
        },
        businessHoursOnly: {
          description: 'Allow transactions only during business hours',
          example: PolicyEngine.POLICY_TEMPLATES.businessHoursOnly(),
        },
        blockedMerchants: {
          description: 'Block specific merchants',
          example: PolicyEngine.POLICY_TEMPLATES.blockedMerchants(['merchant_123']),
        },
      },
    };
  });

  // ============================================================================
  // Audit Trail
  // ============================================================================

  // Get audit trail
  app.get('/audit', async (request, reply) => {
    const query = request.query as any;
    const result = await service.getAuditTrail({
      agentDid: query.agent_did,
      startTime: query.start_time ? new Date(query.start_time) : undefined,
      endTime: query.end_time ? new Date(query.end_time) : undefined,
      action: query.action,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
    });
    return result;
  });

  // Verify audit integrity
  app.get('/audit/verify', async () => {
    const result = await service.verifyAuditIntegrity();
    return result;
  });

  // Get agent audit trail
  app.get('/agents/:did/audit', async (request, reply) => {
    const { did } = request.params as any;
    const query = request.query as any;
    const result = await service.getAuditTrail({
      agentDid: did,
      startTime: query.start_time ? new Date(query.start_time) : undefined,
      endTime: query.end_time ? new Date(query.end_time) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
    });
    return result;
  });

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  // Get rate limit status
  app.get('/agents/:did/rate-limit', async (request, reply) => {
    const { did } = request.params as any;
    const status = await service.getRateLimiter().getStatus(did);
    return status;
  });

  // Reset rate limit (admin)
  app.post('/agents/:did/rate-limit/reset', async (request, reply) => {
    const { did } = request.params as any;
    await service.getRateLimiter().resetLimit(did);
    return { success: true };
  });

  // Get spending history
  app.get('/agents/:did/spending-history', async (request, reply) => {
    const { did } = request.params as any;
    const query = request.query as any;
    const hours = query.hours ? parseInt(query.hours, 10) : 24;
    const history = await service.getRateLimiter().getSpendingHistory(did, hours);
    return { history };
  });

  // ============================================================================
  // Global Controls
  // ============================================================================

  // Set global freeze
  app.post('/global/freeze', async (request, reply) => {
    const { frozen } = request.body as any;
    await service.getIdentityService().setGlobalFreeze(frozen);
    return { success: true, frozen };
  });

  // Get global status
  app.get('/global/status', async () => {
    const frozen = await service.getIdentityService().isGlobalFreezeActive();
    return { frozen };
  });

  // ============================================================================
  // Vault (Secrets)
  // ============================================================================

  // Store secret
  app.post('/vault/secrets', async (request, reply) => {
    const { key_name, value } = request.body as any;
    await service.storeSecret(key_name, value);
    return reply.code(201).send({ success: true });
  });

  // List secret keys (not values)
  app.get('/vault/keys', async () => {
    // Note: This would need to be implemented in VaultService
    return { message: 'List of stored key names (values are encrypted)' };
  });

  return app;
}

export async function runHTTPServer(port: number = 3000): Promise<void> {
  const app = await createHTTPServer();
  
  try {
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Guthwine HTTP Server running on port ${port}`);
  } catch (error) {
    console.error('Failed to start HTTP server:', error);
    process.exit(1);
  }
}
