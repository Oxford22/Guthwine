/**
 * Guthwine Demo HTTP Server
 * 
 * Lightweight HTTP API for the demo environment.
 * Uses Node.js built-in http module for zero dependencies.
 */

import http from 'http';
import { DemoService } from './services/demo-service.js';
import { randomUUID } from 'crypto';

let service: DemoService;

export async function startServer(port: number = 3000): Promise<http.Server> {
  service = new DemoService();

  // Ensure demo data exists
  ensureDemoData();

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const path = url.pathname;

    try {
      // Parse body for POST/PUT requests
      let body: any = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        body = await parseBody(req);
      }

      // Route handling
      if (path === '/api/v1/health' && req.method === 'GET') {
        sendJson(res, { status: 'ok', version: '2.0.0', mode: 'demo' });
      }
      else if (path === '/api/v1/authorize' && req.method === 'POST') {
        const result = await service.authorize({
          agentDid: body.agentDid || body.agent_did,
          agentId: body.agentId || body.agent_id,
          action: body.action,
          amount: body.amount,
          currency: body.currency || 'USD',
          merchantId: body.merchantId || body.merchant_id,
          reason: body.reason
        });
        sendJson(res, result);
      }
      else if (path === '/api/v1/agents' && req.method === 'GET') {
        const orgId = url.searchParams.get('organizationId') || url.searchParams.get('org_id');
        if (!orgId) {
          sendError(res, 400, 'organizationId is required');
          return;
        }
        const agents = service.listAgents(orgId);
        sendJson(res, { agents });
      }
      else if (path === '/api/v1/agents' && req.method === 'POST') {
        const agent = service.createAgent({
          organizationId: body.organizationId || body.organization_id,
          name: body.name,
          did: body.did,
          capabilities: body.capabilities
        });
        sendJson(res, agent, 201);
      }
      else if (path.match(/^\/api\/v1\/agents\/[^/]+$/) && req.method === 'GET') {
        const id = path.split('/').pop()!;
        const agent = service.getAgent(id);
        if (!agent) {
          sendError(res, 404, 'Agent not found');
          return;
        }
        sendJson(res, agent);
      }
      else if (path.match(/^\/api\/v1\/agents\/[^/]+\/freeze$/) && req.method === 'POST') {
        const id = path.split('/')[4];
        if (!id) { sendError(res, 400, 'Agent ID required'); return; }
        const agent = service.freezeAgent(id);
        if (!agent) {
          sendError(res, 404, 'Agent not found');
          return;
        }
        sendJson(res, agent);
      }
      else if (path.match(/^\/api\/v1\/agents\/[^/]+\/unfreeze$/) && req.method === 'POST') {
        const id = path.split('/')[4];
        if (!id) { sendError(res, 400, 'Agent ID required'); return; }
        const agent = service.unfreezeAgent(id);
        if (!agent) {
          sendError(res, 404, 'Agent not found');
          return;
        }
        sendJson(res, agent);
      }
      else if (path === '/api/v1/policies' && req.method === 'GET') {
        const orgId = url.searchParams.get('organizationId') || url.searchParams.get('org_id');
        if (!orgId) {
          sendError(res, 400, 'organizationId is required');
          return;
        }
        const policies = service.listPolicies(orgId);
        sendJson(res, { policies });
      }
      else if (path === '/api/v1/policies' && req.method === 'POST') {
        const policy = service.createPolicy({
          organizationId: body.organizationId || body.organization_id,
          name: body.name,
          effect: body.effect || 'ALLOW',
          priority: body.priority || 0,
          rules: body.rules,
          scope: body.scope || 'ORGANIZATION'
        });
        sendJson(res, policy, 201);
      }
      else if (path === '/api/v1/transactions' && req.method === 'GET') {
        const agentId = url.searchParams.get('agentId') || url.searchParams.get('agent_id');
        if (!agentId) {
          sendError(res, 400, 'agentId is required');
          return;
        }
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const transactions = service.listTransactions(agentId, limit);
        sendJson(res, { transactions });
      }
      else if (path === '/api/v1/audit' && req.method === 'GET') {
        const orgId = url.searchParams.get('organizationId') || url.searchParams.get('org_id');
        if (!orgId) {
          sendError(res, 400, 'organizationId is required');
          return;
        }
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const logs = service.listAuditLogs(orgId, limit);
        sendJson(res, { auditLogs: logs });
      }
      else if (path === '/api/v1/stats' && req.method === 'GET') {
        const stats = service.getStats();
        sendJson(res, { db: stats.db });
      }
      else {
        sendError(res, 404, 'Not found');
      }
    } catch (error) {
      console.error('Error:', error);
      sendError(res, 500, (error as Error).message);
    }
  });

  server.listen(port, () => {
    console.log(`Guthwine Demo API running on http://localhost:${port}`);
    console.log('');
    console.log('Available endpoints:');
    console.log('  GET  /api/v1/health');
    console.log('  POST /api/v1/authorize');
    console.log('  GET  /api/v1/agents?organizationId=...');
    console.log('  POST /api/v1/agents');
    console.log('  GET  /api/v1/agents/:id');
    console.log('  POST /api/v1/agents/:id/freeze');
    console.log('  POST /api/v1/agents/:id/unfreeze');
    console.log('  GET  /api/v1/policies?organizationId=...');
    console.log('  POST /api/v1/policies');
    console.log('  GET  /api/v1/transactions?agentId=...');
    console.log('  GET  /api/v1/audit?organizationId=...');
    console.log('  GET  /api/v1/stats');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    service.close();
    server.close();
    process.exit(0);
  });

  return server;
}

function ensureDemoData(): void {
  const stats = service.getStats();
  if (stats.db.agents === 0) {
    // Create demo organization
    const org = service.createOrganization({
      id: 'demo-org-1',
      name: 'Demo Organization',
      slug: 'demo-org',
      tier: 'PROFESSIONAL'
    });

    // Create demo agent
    service.createAgent({
      organizationId: org.id,
      name: 'Demo Agent',
      did: 'did:guthwine:demo-agent-1'
    });

    console.log('Created demo data.');
  }
}

async function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, data: any, status: number = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

// Allow direct execution
// Direct execution check removed for CommonJS compatibility
