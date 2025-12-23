/**
 * Guthwine MCP Server
 * Model Context Protocol server for AI agent integration
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  GuthwineService,
  DelegationService,
  PolicyEngine,
} from '@guthwine/api/services';

// =============================================================================
// TOOL SCHEMAS
// =============================================================================

const AuthorizeTransactionSchema = z.object({
  agentDid: z.string().describe('The DID of the agent making the transaction'),
  amount: z.number().positive().describe('Transaction amount'),
  currency: z.string().default('USD').describe('Currency code (e.g., USD, EUR)'),
  merchantId: z.string().describe('Unique identifier of the merchant'),
  merchantName: z.string().optional().describe('Human-readable merchant name'),
  merchantCategory: z.string().optional().describe('Merchant category code'),
  reasoningTrace: z.string().optional().describe('Agent reasoning for this transaction'),
  delegationChain: z.array(z.string()).optional().describe('Delegation chain tokens'),
});

const ExecuteTransactionSchema = z.object({
  transactionId: z.string().describe('The approved transaction ID'),
  mandateToken: z.string().describe('The mandate token from authorization'),
  paymentRail: z.enum(['STRIPE', 'COINBASE', 'WISE', 'PLAID', 'WEBHOOK', 'MANUAL']).describe('Payment rail to use'),
});

const CreateDelegationSchema = z.object({
  issuerAgentId: z.string().describe('Agent issuing the delegation'),
  recipientAgentId: z.string().describe('Agent receiving the delegation'),
  constraints: z.object({
    maxAmount: z.number().optional().describe('Maximum transaction amount'),
    allowedMerchants: z.array(z.string()).optional().describe('Allowed merchant IDs'),
    blockedMerchants: z.array(z.string()).optional().describe('Blocked merchant IDs'),
    allowedCategories: z.array(z.string()).optional().describe('Allowed merchant categories'),
    semanticConstraints: z.string().optional().describe('Natural language constraints'),
    expiresInSeconds: z.number().optional().describe('Expiration time in seconds'),
  }).describe('Delegation constraints'),
});

const RevokeDelegationSchema = z.object({
  delegationId: z.string().describe('ID of the delegation to revoke'),
  reason: z.string().describe('Reason for revocation'),
});

const FreezeAgentSchema = z.object({
  agentId: z.string().describe('ID of the agent to freeze'),
  reason: z.string().describe('Reason for freezing'),
});

const RegisterAgentSchema = z.object({
  name: z.string().describe('Name of the agent'),
  type: z.enum(['PRIMARY', 'DELEGATED', 'SERVICE', 'EPHEMERAL']).optional().describe('Agent type'),
  parentAgentId: z.string().optional().describe('Parent agent ID for hierarchical agents'),
});

const AddPolicySchema = z.object({
  agentId: z.string().describe('Agent to add policy to'),
  name: z.string().describe('Policy name'),
  description: z.string().optional().describe('Policy description'),
  rules: z.record(z.unknown()).describe('JSON Logic rules'),
  priority: z.number().optional().describe('Policy priority'),
});

// =============================================================================
// MCP SERVER
// =============================================================================

export class GuthwineMCPServer {
  private server: Server;
  private guthwineService: GuthwineService;
  private organizationId: string;
  private userId: string;

  constructor(config: {
    organizationId: string;
    userId: string;
  }) {
    this.organizationId = config.organizationId;
    this.userId = config.userId;
    this.guthwineService = new GuthwineService();

    this.server = new Server(
      {
        name: 'guthwine',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'authorize_transaction',
          description: 'Request authorization for a financial transaction. Returns approval status and mandate token.',
          inputSchema: {
            type: 'object',
            properties: {
              agentDid: { type: 'string', description: 'The DID of the agent making the transaction' },
              amount: { type: 'number', description: 'Transaction amount' },
              currency: { type: 'string', description: 'Currency code (e.g., USD, EUR)' },
              merchantId: { type: 'string', description: 'Unique identifier of the merchant' },
              merchantName: { type: 'string', description: 'Human-readable merchant name' },
              merchantCategory: { type: 'string', description: 'Merchant category code' },
              reasoningTrace: { type: 'string', description: 'Agent reasoning for this transaction' },
            },
            required: ['agentDid', 'amount', 'merchantId'],
          },
        },
        {
          name: 'execute_transaction',
          description: 'Execute an approved transaction using the mandate token.',
          inputSchema: {
            type: 'object',
            properties: {
              transactionId: { type: 'string', description: 'The approved transaction ID' },
              mandateToken: { type: 'string', description: 'The mandate token from authorization' },
              paymentRail: { type: 'string', enum: ['STRIPE', 'COINBASE', 'WISE', 'PLAID', 'WEBHOOK', 'MANUAL'], description: 'Payment rail to use' },
            },
            required: ['transactionId', 'mandateToken', 'paymentRail'],
          },
        },
        {
          name: 'create_delegation',
          description: 'Create a delegation token to grant another agent limited spending authority.',
          inputSchema: {
            type: 'object',
            properties: {
              issuerAgentId: { type: 'string', description: 'Agent issuing the delegation' },
              recipientAgentId: { type: 'string', description: 'Agent receiving the delegation' },
              constraints: {
                type: 'object',
                properties: {
                  maxAmount: { type: 'number', description: 'Maximum transaction amount' },
                  allowedMerchants: { type: 'array', items: { type: 'string' }, description: 'Allowed merchant IDs' },
                  blockedMerchants: { type: 'array', items: { type: 'string' }, description: 'Blocked merchant IDs' },
                  allowedCategories: { type: 'array', items: { type: 'string' }, description: 'Allowed merchant categories' },
                  semanticConstraints: { type: 'string', description: 'Natural language constraints' },
                  expiresInSeconds: { type: 'number', description: 'Expiration time in seconds' },
                },
              },
            },
            required: ['issuerAgentId', 'recipientAgentId', 'constraints'],
          },
        },
        {
          name: 'revoke_delegation',
          description: 'Revoke an existing delegation.',
          inputSchema: {
            type: 'object',
            properties: {
              delegationId: { type: 'string', description: 'ID of the delegation to revoke' },
              reason: { type: 'string', description: 'Reason for revocation' },
            },
            required: ['delegationId', 'reason'],
          },
        },
        {
          name: 'freeze_agent',
          description: 'Freeze an agent to prevent all transactions (kill switch).',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'ID of the agent to freeze' },
              reason: { type: 'string', description: 'Reason for freezing' },
            },
            required: ['agentId', 'reason'],
          },
        },
        {
          name: 'unfreeze_agent',
          description: 'Unfreeze a previously frozen agent.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'ID of the agent to unfreeze' },
            },
            required: ['agentId'],
          },
        },
        {
          name: 'register_agent',
          description: 'Register a new agent in the system.',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name of the agent' },
              type: { type: 'string', enum: ['PRIMARY', 'DELEGATED', 'SERVICE', 'EPHEMERAL'], description: 'Agent type' },
              parentAgentId: { type: 'string', description: 'Parent agent ID for hierarchical agents' },
            },
            required: ['name'],
          },
        },
        {
          name: 'get_agent',
          description: 'Get information about an agent.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'ID of the agent' },
            },
            required: ['agentId'],
          },
        },
        {
          name: 'add_policy',
          description: 'Add a policy to an agent.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Agent to add policy to' },
              name: { type: 'string', description: 'Policy name' },
              description: { type: 'string', description: 'Policy description' },
              rules: { type: 'object', description: 'JSON Logic rules' },
              priority: { type: 'number', description: 'Policy priority' },
            },
            required: ['agentId', 'name', 'rules'],
          },
        },
        {
          name: 'get_audit_trail',
          description: 'Get audit trail for an agent or transaction.',
          inputSchema: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Filter by agent ID' },
              transactionId: { type: 'string', description: 'Filter by transaction ID' },
              limit: { type: 'number', description: 'Maximum number of entries' },
            },
          },
        },
        {
          name: 'verify_audit_integrity',
          description: 'Verify the integrity of the audit trail.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'guthwine://agents',
          name: 'Agents',
          description: 'List of all agents in the organization',
          mimeType: 'application/json',
        },
        {
          uri: 'guthwine://policies',
          name: 'Policies',
          description: 'List of all policies',
          mimeType: 'application/json',
        },
        {
          uri: 'guthwine://audit',
          name: 'Audit Trail',
          description: 'Recent audit log entries',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri === 'guthwine://agents') {
        // Return list of agents (simplified)
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ message: 'Use get_agent tool to fetch specific agent data' }),
            },
          ],
        };
      }

      if (uri === 'guthwine://audit') {
        const logs = await this.guthwineService.getAuditTrail({
          organizationId: this.organizationId,
          limit: 50,
        });
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(logs, null, 2),
            },
          ],
        };
      }

      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'authorize_transaction': {
            const input = AuthorizeTransactionSchema.parse(args);
            const result = await this.guthwineService.authorizeTransaction({
              organizationId: this.organizationId,
              ...input,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'execute_transaction': {
            const input = ExecuteTransactionSchema.parse(args);
            const result = await this.guthwineService.executeTransaction(input);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'create_delegation': {
            const input = CreateDelegationSchema.parse(args);
            const result = await this.guthwineService.issueDelegation({
              organizationId: this.organizationId,
              issuedByUserId: this.userId,
              ...input,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'revoke_delegation': {
            const input = RevokeDelegationSchema.parse(args);
            await this.guthwineService.revokeDelegation(
              input.delegationId,
              input.reason,
              this.userId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
            };
          }

          case 'freeze_agent': {
            const input = FreezeAgentSchema.parse(args);
            await this.guthwineService.freezeAgent(
              input.agentId,
              input.reason,
              this.userId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
            };
          }

          case 'unfreeze_agent': {
            const { agentId } = args as { agentId: string };
            await this.guthwineService.unfreezeAgent(agentId, this.userId);
            return {
              content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
            };
          }

          case 'register_agent': {
            const input = RegisterAgentSchema.parse(args);
            const result = await this.guthwineService.registerAgent({
              organizationId: this.organizationId,
              createdByUserId: this.userId,
              ...input,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_agent': {
            const { agentId } = args as { agentId: string };
            const agent = await this.guthwineService.getAgent(agentId);
            if (!agent) {
              throw new McpError(ErrorCode.InvalidRequest, 'Agent not found');
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }],
            };
          }

          case 'add_policy': {
            const input = AddPolicySchema.parse(args);
            const result = await this.guthwineService.addPolicy({
              organizationId: this.organizationId,
              createdByUserId: this.userId,
              ...input,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_audit_trail': {
            const { agentId, transactionId, limit } = args as {
              agentId?: string;
              transactionId?: string;
              limit?: number;
            };
            const logs = await this.guthwineService.getAuditTrail({
              organizationId: this.organizationId,
              agentId,
              transactionId,
              limit,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }],
            };
          }

          case 'verify_audit_integrity': {
            const result = await this.guthwineService.verifyAuditIntegrity(
              this.organizationId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    });
  }

  async start(): Promise<void> {
    await this.guthwineService.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Guthwine MCP server running on stdio');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const organizationId = process.env.GUTHWINE_ORG_ID || 'default-org';
  const userId = process.env.GUTHWINE_USER_ID || 'system';
  
  const server = new GuthwineMCPServer({ organizationId, userId });
  server.start().catch(console.error);
}

export default GuthwineMCPServer;
