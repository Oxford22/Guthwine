/**
 * Guthwine HTTP API Server
 * Fastify-based REST API with OpenAPI documentation
 */

import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import crypto from 'crypto';
import {
  GuthwineService,
  DelegationService,
  PolicyEngine,
  PaymentRailService,
} from './services/index.js';
import { prisma, connectDatabase, disconnectDatabase } from '@guthwine/database';

// =============================================================================
// TYPES
// =============================================================================

interface AuthenticatedRequest extends FastifyRequest {
  session?: {
    userId: string;
    organizationId: string;
    role: string;
    permissions: string[];
  };
}

// =============================================================================
// SERVER SETUP
// =============================================================================

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
  });

  // Initialize services
  const guthwineService = new GuthwineService();
  await guthwineService.initialize();

  // Register plugins
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // OpenAPI documentation
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Guthwine API',
        description: 'Sovereign Governance Layer for AI Agents',
        version: '2.0.0',
      },
      servers: [
        { url: process.env.API_URL || 'http://localhost:3000' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // Authentication hook
  app.addHook('preHandler', async (request: AuthenticatedRequest, reply) => {
    const publicRoutes = ['/health', '/docs', '/docs/'];
    if (publicRoutes.some(r => request.url.startsWith(r))) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string;
    if (apiKey) {
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const key = await prisma.aPIKey.findFirst({
        where: { keyHash, isActive: true },
      });
      if (key && (!key.expiresAt || key.expiresAt > new Date())) {
        request.session = {
          userId: key.createdById,
          organizationId: key.organizationId,
          role: 'API_KEY',
          permissions: key.permissions,
        };
        await prisma.aPIKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
        });
        return;
      }
    }

    reply.code(401).send({ error: 'Unauthorized' });
  });

  // =============================================================================
  // HEALTH CHECK
  // =============================================================================

  app.get('/health', async () => {
    return {
      status: 'healthy',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
    };
  });

  // =============================================================================
  // AGENT ROUTES
  // =============================================================================

  app.post('/api/v2/agents', async (request: AuthenticatedRequest, reply) => {
    const body = request.body as {
      name: string;
      type?: 'PRIMARY' | 'DELEGATED' | 'SERVICE' | 'EPHEMERAL';
      parentAgentId?: string;
      metadata?: Record<string, unknown>;
    };

    const agent = await guthwineService.registerAgent({
      organizationId: request.session!.organizationId,
      name: body.name,
      type: body.type,
      parentAgentId: body.parentAgentId,
      createdByUserId: request.session!.userId,
      metadata: body.metadata,
    });

    return reply.code(201).send(agent);
  });

  app.get('/api/v2/agents/:agentId', async (request: AuthenticatedRequest, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = await guthwineService.getAgent(agentId);
    
    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }
    
    return agent;
  });

  app.post('/api/v2/agents/:agentId/freeze', async (request: AuthenticatedRequest, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { reason } = request.body as { reason: string };

    await guthwineService.freezeAgent(
      agentId,
      reason,
      request.session!.userId
    );

    return { success: true };
  });

  app.post('/api/v2/agents/:agentId/unfreeze', async (request: AuthenticatedRequest, reply) => {
    const { agentId } = request.params as { agentId: string };

    await guthwineService.unfreezeAgent(
      agentId,
      request.session!.userId
    );

    return { success: true };
  });

  // =============================================================================
  // TRANSACTION ROUTES
  // =============================================================================

  app.post('/api/v2/transactions/authorize', async (request: AuthenticatedRequest, reply) => {
    const body = request.body as {
      agentDid: string;
      amount: number;
      currency: string;
      merchantId: string;
      merchantName?: string;
      merchantCategory?: string;
      reasoningTrace?: string;
      delegationChain?: string[];
      metadata?: Record<string, unknown>;
    };

    const result = await guthwineService.authorizeTransaction({
      organizationId: request.session!.organizationId,
      ...body,
    });

    return result;
  });

  app.post('/api/v2/transactions/:transactionId/execute', async (request: AuthenticatedRequest, reply) => {
    const { transactionId } = request.params as { transactionId: string };
    const body = request.body as {
      mandateToken: string;
      paymentRail: 'STRIPE' | 'COINBASE' | 'WISE' | 'PLAID' | 'WEBHOOK' | 'MANUAL';
      railParams?: Record<string, unknown>;
    };

    const result = await guthwineService.executeTransaction({
      transactionId,
      ...body,
    });

    return result;
  });

  // =============================================================================
  // POLICY ROUTES
  // =============================================================================

  app.post('/api/v2/agents/:agentId/policies', async (request: AuthenticatedRequest, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as {
      name: string;
      description?: string;
      rules: Record<string, unknown>;
      priority?: number;
    };

    const policy = await guthwineService.addPolicy({
      organizationId: request.session!.organizationId,
      agentId,
      createdByUserId: request.session!.userId,
      ...body,
    });

    return reply.code(201).send(policy);
  });

  app.get('/api/v2/agents/:agentId/policies', async (request: AuthenticatedRequest, reply) => {
    const { agentId } = request.params as { agentId: string };
    const policies = await guthwineService.getPolicies(agentId);
    return policies;
  });

  // =============================================================================
  // DELEGATION ROUTES
  // =============================================================================

  app.post('/api/v2/delegations', async (request: AuthenticatedRequest, reply) => {
    const body = request.body as {
      issuerAgentId: string;
      recipientAgentId: string;
      constraints: {
        maxAmount?: number;
        allowedMerchants?: string[];
        blockedMerchants?: string[];
        allowedCategories?: string[];
        semanticConstraints?: string;
        expiresInSeconds?: number;
      };
    };

    const delegation = await guthwineService.issueDelegation({
      organizationId: request.session!.organizationId,
      issuedByUserId: request.session!.userId,
      ...body,
    });

    return reply.code(201).send(delegation);
  });

  app.delete('/api/v2/delegations/:delegationId', async (request: AuthenticatedRequest, reply) => {
    const { delegationId } = request.params as { delegationId: string };
    const { reason } = request.body as { reason: string };

    await guthwineService.revokeDelegation(
      delegationId,
      reason,
      request.session!.userId
    );

    return { success: true };
  });

  // =============================================================================
  // AUDIT ROUTES
  // =============================================================================

  app.get('/api/v2/audit', async (request: AuthenticatedRequest, reply) => {
    const query = request.query as {
      agentId?: string;
      transactionId?: string;
      limit?: string;
      offset?: string;
    };

    const logs = await guthwineService.getAuditTrail({
      organizationId: request.session!.organizationId,
      agentId: query.agentId,
      transactionId: query.transactionId,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });

    return logs;
  });

  app.get('/api/v2/audit/verify', async (request: AuthenticatedRequest, reply) => {
    const result = await guthwineService.verifyAuditIntegrity(
      request.session!.organizationId
    );
    return result;
  });

  // =============================================================================
  // GLOBAL CONTROLS
  // =============================================================================

  app.post('/api/v2/global/freeze', async (request: AuthenticatedRequest, reply) => {
    const { reason } = request.body as { reason: string };

    await guthwineService.setGlobalFreeze(
      request.session!.organizationId,
      true,
      reason,
      request.session!.userId
    );

    return { success: true };
  });

  app.post('/api/v2/global/unfreeze', async (request: AuthenticatedRequest, reply) => {
    await guthwineService.setGlobalFreeze(
      request.session!.organizationId,
      false,
      'Unfrozen',
      request.session!.userId
    );

    return { success: true };
  });

  return app;
}

// =============================================================================
// START SERVER
// =============================================================================

export async function startServer(port: number = 3000): Promise<void> {
  const app = await createServer();

  await connectDatabase();

  await app.listen({ port, host: '0.0.0.0' });
  console.log(`Guthwine API server running on port ${port}`);
  console.log(`Documentation available at http://localhost:${port}/docs`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(parseInt(process.env.PORT || '3000'));
}
