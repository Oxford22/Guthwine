#!/usr/bin/env node
/**
 * Guthwine Demo MCP Server
 * 
 * Model Context Protocol server for AI agent integration.
 * Works with the zero-dependency demo environment.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DemoService } from './services/demo-service.js';

const service = new DemoService();

// Ensure demo data exists
const stats = service.getStats();
if (stats.db.agents === 0) {
  const org = service.createOrganization({
    name: 'MCP Demo Org',
    slug: 'mcp-demo'
  });
  service.createAgent({
    organizationId: org.id,
    name: 'MCP Agent',
    did: 'did:guthwine:mcp-agent-1'
  });
}

const server = new Server(
  {
    name: 'guthwine-demo',
    version: '2.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'authorize_transaction',
        description: 'Request authorization for a transaction. Returns approval status and mandate token.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'The action to perform (e.g., "purchase", "transfer", "booking")'
            },
            reason: {
              type: 'string',
              description: 'Detailed reason for the transaction'
            },
            amount: {
              type: 'number',
              description: 'Transaction amount'
            },
            currency: {
              type: 'string',
              description: 'Currency code (default: USD)',
              default: 'USD'
            },
            merchantId: {
              type: 'string',
              description: 'Optional merchant identifier'
            }
          },
          required: ['action', 'reason']
        }
      },
      {
        name: 'check_agent_status',
        description: 'Check the status of an agent including freeze state and capabilities.',
        inputSchema: {
          type: 'object',
          properties: {
            agentDid: {
              type: 'string',
              description: 'Agent DID to check'
            }
          },
          required: ['agentDid']
        }
      },
      {
        name: 'list_transactions',
        description: 'List recent transactions for an agent.',
        inputSchema: {
          type: 'object',
          properties: {
            agentDid: {
              type: 'string',
              description: 'Agent DID'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of transactions to return',
              default: 10
            }
          },
          required: ['agentDid']
        }
      },
      {
        name: 'get_budget_status',
        description: 'Get remaining budget for an agent.',
        inputSchema: {
          type: 'object',
          properties: {
            agentDid: {
              type: 'string',
              description: 'Agent DID'
            }
          },
          required: ['agentDid']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'authorize_transaction': {
        const agentDid = process.env.GUTHWINE_AGENT_DID || 'did:guthwine:mcp-agent-1';
        const result = await service.authorize({
          agentDid,
          action: (args as any).action,
          reason: (args as any).reason,
          amount: (args as any).amount,
          currency: (args as any).currency || 'USD',
          merchantId: (args as any).merchantId
        });

        if (result.approved) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'APPROVED',
                  transactionId: result.transactionId,
                  mandateToken: result.mandateToken,
                  riskScore: result.riskScore,
                  message: 'Transaction authorized. Use the mandate token to execute the transaction.'
                }, null, 2)
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'DENIED',
                  transactionId: result.transactionId,
                  reason: result.denialReason,
                  riskScore: result.riskScore,
                  message: 'Transaction denied. See reason for details.'
                }, null, 2)
              }
            ]
          };
        }
      }

      case 'check_agent_status': {
        const agent = service.getAgent((args as any).agentDid);
        if (!agent) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: agent.id,
                did: agent.did,
                name: agent.name,
                status: agent.status,
                capabilities: agent.capabilities,
                createdAt: agent.createdAt
              }, null, 2)
            }
          ]
        };
      }

      case 'list_transactions': {
        const agent = service.getAgent((args as any).agentDid);
        if (!agent) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }
        const transactions = service.listTransactions(agent.id, (args as any).limit || 10);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                count: transactions.length,
                transactions: transactions.map(t => ({
                  id: t.id,
                  action: t.action,
                  amount: t.amount,
                  currency: t.currency,
                  status: t.status,
                  createdAt: t.createdAt
                }))
              }, null, 2)
            }
          ]
        };
      }

      case 'get_budget_status': {
        const agent = service.getAgent((args as any).agentDid);
        if (!agent) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }]
          };
        }
        // For demo, return a simple budget status
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                agentDid: agent.did,
                budgetLimit: 10000,
                period: 'monthly',
                message: 'Budget tracking is active. Transactions are monitored against the monthly limit.'
              }, null, 2)
            }
          ]
        };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }]
        };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }]
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Guthwine Demo MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
