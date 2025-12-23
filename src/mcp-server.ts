/**
 * Guthwine - MCP Server
 * Model Context Protocol server for AI agent governance
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { GuthwineService } from './services/GuthwineService.js';
import { PolicyEngine } from './services/PolicyEngine.js';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'request_transaction_signature',
    description: 
      'Request authorization for a financial transaction. Returns a signed mandate if approved, ' +
      'or a denial with policy violations if rejected. This is the core governance function.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'The DID of the requesting agent',
        },
        amount: {
          type: 'number',
          description: 'Transaction amount',
        },
        currency: {
          type: 'string',
          description: 'Currency code (default: USD)',
          default: 'USD',
        },
        merchant_id: {
          type: 'string',
          description: 'Merchant identifier',
        },
        merchant_name: {
          type: 'string',
          description: 'Human-readable merchant name',
        },
        merchant_category: {
          type: 'string',
          description: 'Merchant category code',
        },
        reasoning_trace: {
          type: 'string',
          description: 'AI explanation for why this transaction is needed',
        },
        delegation_chain: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of delegation token JWTs (if acting on behalf of another agent)',
        },
      },
      required: ['agent_did', 'amount', 'merchant_id', 'reasoning_trace'],
    },
  },
  {
    name: 'register_agent',
    description: 
      'Register a new AI agent and generate its decentralized identity (DID). ' +
      'Returns the agent\'s DID and public key.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Agent name',
        },
        description: {
          type: 'string',
          description: 'Agent description',
        },
        owner_did: {
          type: 'string',
          description: 'Parent agent or user DID',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'issue_delegation',
    description: 
      'Issue a delegation token granting another agent permission to transact. ' +
      'Supports hierarchical constraints and recursive delegation.',
    inputSchema: {
      type: 'object',
      properties: {
        issuer_did: {
          type: 'string',
          description: 'DID of the agent issuing the delegation',
        },
        recipient_did: {
          type: 'string',
          description: 'DID of the agent receiving delegation',
        },
        max_amount: {
          type: 'number',
          description: 'Maximum transaction amount',
        },
        currency: {
          type: 'string',
          description: 'Allowed currency',
        },
        allowed_merchants: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of allowed merchant IDs',
        },
        allowed_categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of allowed merchant categories',
        },
        semantic_constraints: {
          type: 'string',
          description: 'Natural language constraints (e.g., "Only sustainable products")',
        },
        expires_in_seconds: {
          type: 'number',
          description: 'Token expiration in seconds (default: 3600)',
          default: 3600,
        },
      },
      required: ['issuer_did', 'recipient_did'],
    },
  },
  {
    name: 'revoke_delegation',
    description: 'Revoke a previously issued delegation token.',
    inputSchema: {
      type: 'object',
      properties: {
        token_hash: {
          type: 'string',
          description: 'Hash of the delegation token to revoke',
        },
        reason: {
          type: 'string',
          description: 'Reason for revocation',
        },
      },
      required: ['token_hash', 'reason'],
    },
  },
  {
    name: 'freeze_agent',
    description: 
      'Freeze an agent, immediately blocking all transactions (Kill Switch). ' +
      'Also revokes all delegations issued by the agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'DID of the agent to freeze',
        },
        reason: {
          type: 'string',
          description: 'Reason for freezing',
        },
      },
      required: ['agent_did', 'reason'],
    },
  },
  {
    name: 'unfreeze_agent',
    description: 'Unfreeze a previously frozen agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'DID of the agent to unfreeze',
        },
      },
      required: ['agent_did'],
    },
  },
  {
    name: 'add_policy',
    description: 
      'Add a policy rule for an agent. Policies use JSON Logic for rule evaluation ' +
      'and can include semantic constraints evaluated by LLM.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Agent DID to add policy for',
        },
        name: {
          type: 'string',
          description: 'Policy name',
        },
        description: {
          type: 'string',
          description: 'Policy description',
        },
        rules: {
          type: 'object',
          description: 'JSON Logic rules',
        },
        semantic_constraints: {
          type: 'string',
          description: 'Natural language constraints for LLM evaluation',
        },
        priority: {
          type: 'number',
          description: 'Policy priority (higher = evaluated first)',
          default: 0,
        },
      },
      required: ['agent_did', 'name', 'rules'],
    },
  },
  {
    name: 'get_policies',
    description: 'Get all policies for an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Agent DID',
        },
      },
      required: ['agent_did'],
    },
  },
  {
    name: 'get_audit_trail',
    description: 
      'Get the immutable audit trail. Supports filtering by agent, time range, and action type.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Filter by agent DID',
        },
        start_time: {
          type: 'string',
          description: 'Start time (ISO 8601)',
        },
        end_time: {
          type: 'string',
          description: 'End time (ISO 8601)',
        },
        action: {
          type: 'string',
          description: 'Filter by action type',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of entries',
          default: 100,
        },
      },
    },
  },
  {
    name: 'verify_audit_integrity',
    description: 
      'Verify the integrity of the audit log using Merkle tree verification. ' +
      'Detects any tampering with historical records.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_agent_info',
    description: 'Get information about an agent including reputation score.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Agent DID',
        },
      },
      required: ['agent_did'],
    },
  },
  {
    name: 'store_secret',
    description: 'Store a secret (API key) in the encrypted vault.',
    inputSchema: {
      type: 'object',
      properties: {
        key_name: {
          type: 'string',
          description: 'Name for the secret (e.g., "stripe_api_key")',
        },
        value: {
          type: 'string',
          description: 'Secret value to store',
        },
      },
      required: ['key_name', 'value'],
    },
  },
  {
    name: 'get_rate_limit_status',
    description: 'Get current rate limit status for an agent.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_did: {
          type: 'string',
          description: 'Agent DID',
        },
      },
      required: ['agent_did'],
    },
  },
  {
    name: 'set_global_freeze',
    description: 'Set global freeze state (emergency kill switch for all agents).',
    inputSchema: {
      type: 'object',
      properties: {
        frozen: {
          type: 'boolean',
          description: 'Whether to freeze all agents',
        },
      },
      required: ['frozen'],
    },
  },
];

// Create MCP Server
export async function createMCPServer(): Promise<Server> {
  const guthwine = new GuthwineService({
    enableSemanticFirewall: true,
    enableRateLimiting: true,
    enableSemanticPolicyCheck: true,
  });

  await guthwine.initialize();

  const server = new Server(
    {
      name: 'guthwine',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      switch (name) {
        case 'request_transaction_signature': {
          const result = await guthwine.requestTransactionSignature(
            args.agent_did as string,
            {
              amount: args.amount as number,
              currency: (args.currency as string) || 'USD',
              merchantId: args.merchant_id as string,
              merchantName: args.merchant_name as string,
              merchantCategory: args.merchant_category as string,
              reasoningTrace: args.reasoning_trace as string,
            },
            args.delegation_chain as string[]
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'register_agent': {
          const agent = await guthwine.registerAgent({
            name: args.name as string,
            description: args.description as string,
            ownerDid: args.owner_did as string,
          });
          return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] };
        }

        case 'issue_delegation': {
          const result = await guthwine.issueDelegation(
            args.issuer_did as string,
            args.recipient_did as string,
            {
              maxAmount: args.max_amount as number,
              currency: args.currency as string,
              allowedMerchants: args.allowed_merchants as string[],
              allowedCategories: args.allowed_categories as string[],
              semanticConstraints: args.semantic_constraints as string,
              expiresIn: (args.expires_in_seconds as number) || 3600,
            }
          );
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'revoke_delegation': {
          const success = await guthwine.revokeDelegation(
            args.token_hash as string,
            args.reason as string
          );
          return {
            content: [{ type: 'text', text: JSON.stringify({ success }, null, 2) }],
          };
        }

        case 'freeze_agent': {
          const success = await guthwine.freezeAgent(
            args.agent_did as string,
            args.reason as string
          );
          return {
            content: [{ type: 'text', text: JSON.stringify({ success }, null, 2) }],
          };
        }

        case 'unfreeze_agent': {
          const success = await guthwine.unfreezeAgent(args.agent_did as string);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success }, null, 2) }],
          };
        }

        case 'add_policy': {
          const policyId = await guthwine.addPolicy(
            args.agent_did as string,
            args.name as string,
            args.rules,
            {
              description: args.description as string,
              semanticConstraints: args.semantic_constraints as string,
              priority: args.priority as number,
            }
          );
          return {
            content: [{ type: 'text', text: JSON.stringify({ policyId }, null, 2) }],
          };
        }

        case 'get_policies': {
          const policies = await guthwine.getPolicies(args.agent_did as string);
          return { content: [{ type: 'text', text: JSON.stringify(policies, null, 2) }] };
        }

        case 'get_audit_trail': {
          const result = await guthwine.getAuditTrail({
            agentDid: args.agent_did as string,
            startTime: args.start_time ? new Date(args.start_time as string) : undefined,
            endTime: args.end_time ? new Date(args.end_time as string) : undefined,
            action: args.action as string,
            limit: (args.limit as number) || 100,
          });
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'verify_audit_integrity': {
          const result = await guthwine.verifyAuditIntegrity();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        case 'get_agent_info': {
          const agent = await guthwine.getAgent(args.agent_did as string);
          if (!agent) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'Agent not found' }) }],
            };
          }
          const reputation = await guthwine
            .getIdentityService()
            .getReputationScore(args.agent_did as string);
          return {
            content: [{ type: 'text', text: JSON.stringify({ agent, reputation }, null, 2) }],
          };
        }

        case 'store_secret': {
          await guthwine.storeSecret(args.key_name as string, args.value as string);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }],
          };
        }

        case 'get_rate_limit_status': {
          const status = await guthwine
            .getRateLimiter()
            .getStatus(args.agent_did as string);
          return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
        }

        case 'set_global_freeze': {
          await guthwine.getIdentityService().setGlobalFreeze(args.frozen as boolean);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: true, frozen: args.frozen }, null, 2),
              },
            ],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : 'Unknown error',
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// Main entry point for MCP server
export async function runMCPServer(): Promise<void> {
  const server = await createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Guthwine MCP Server running on stdio');
}
