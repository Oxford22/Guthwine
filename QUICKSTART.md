# Guthwine Quick Start Guide

> **Time to Hello World: < 10 minutes**
> 
> No Docker, PostgreSQL, or Redis required. Just Node.js 18+.

## Prerequisites

- Node.js 18.0.0 or higher
- npm or pnpm

## Installation

```bash
# Clone the repository
git clone https://github.com/Oxford22/Guthwine.git
cd Guthwine

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Run the Interactive Demo

```bash
# Start the interactive demo
pnpm demo

# Or run directly
npx @guthwine/demo start
```

This will:
1. Create a demo organization with sample agents
2. Set up example policies (allow infrastructure, block gambling)
3. Run 4 demo scenarios showing approval/denial flows
4. Display MCP configuration for Claude Desktop

### Demo Output

```
╔═══════════════════════════════════════════════════════════════╗
║  🗡️  GUTHWINE - Sovereign Governance Layer for AI Agents     ║
║      "In the hands of a worthy bearer, never fails."         ║
╚═══════════════════════════════════════════════════════════════╝

📋 Demo Environment:
──────────────────────────────────────────────────────
  Organization: Acme Corp
  Agents:
    • Procurement Bot (did:guthwine:procurement-bot-1)
    • Travel Assistant (did:guthwine:travel-assistant-1)
  Policies: Allow Infrastructure Spending, Block Gambling
──────────────────────────────────────────────────────

🎬 Running Demo Scenarios:

Scenario 1: Infrastructure Purchase (SHOULD APPROVE)
  ✔ APPROVED
    Risk Score: 15/100
    Category: infrastructure

Scenario 2: Gambling Attempt (SHOULD DENY)
  ✖ DENIED
    Reason: Category "gambling" is not permitted by policy.
    Risk Score: 100/100
```

## Start the HTTP API Server

```bash
# Start the API server
pnpm demo:server

# Or with a custom port
npx @guthwine/demo server --port 8080
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/authorize` | Authorize a transaction |
| GET | `/api/v1/agents` | List agents |
| POST | `/api/v1/agents` | Create an agent |
| GET | `/api/v1/agents/:id` | Get agent details |
| POST | `/api/v1/agents/:id/freeze` | Freeze an agent |
| POST | `/api/v1/agents/:id/unfreeze` | Unfreeze an agent |
| GET | `/api/v1/policies` | List policies |
| POST | `/api/v1/policies` | Create a policy |
| GET | `/api/v1/transactions` | List transactions |
| GET | `/api/v1/audit` | Get audit logs |

### Example: Authorize a Transaction

```bash
curl -X POST http://localhost:3000/api/v1/authorize \
  -H "Content-Type: application/json" \
  -d '{
    "agentDid": "did:guthwine:procurement-bot-1",
    "action": "purchase",
    "amount": 500,
    "currency": "USD",
    "reason": "AWS credits for development"
  }'
```

**Response (Approved):**
```json
{
  "approved": true,
  "transactionId": "abc123...",
  "mandateToken": "eyJ...",
  "riskScore": 15,
  "policyEvaluation": {
    "policiesEvaluated": 2,
    "matchedPolicies": ["Allow Infrastructure Spending"],
    "semanticAnalysis": {
      "category": "infrastructure",
      "confidence": 0.85
    }
  }
}
```

## MCP Integration (Claude Desktop)

Add this to your Claude Desktop configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "guthwine": {
      "command": "npx",
      "args": ["-y", "@guthwine/demo", "mcp"],
      "env": {
        "GUTHWINE_AGENT_DID": "did:guthwine:procurement-bot-1"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `authorize_transaction` | Request authorization for a transaction |
| `check_agent_status` | Check agent status and capabilities |
| `list_transactions` | List recent transactions |
| `get_budget_status` | Get remaining budget |

## Programmatic Usage

```typescript
import { DemoService } from '@guthwine/demo';

// Create a new demo service instance
const guthwine = new DemoService();

// Create an organization
const org = guthwine.createOrganization({
  name: 'My Company',
  slug: 'my-company'
});

// Create an agent
const agent = guthwine.createAgent({
  organizationId: org.id,
  name: 'My AI Agent',
  did: 'did:guthwine:my-agent-1'
});

// Create a policy
const policy = guthwine.createPolicy({
  organizationId: org.id,
  name: 'Allow Software Purchases',
  effect: 'ALLOW',
  priority: 100,
  rules: {
    'or': [
      { 'in': [{ 'var': 'transaction.reason' }, ['software', 'license', 'subscription']] },
      { '<=': [{ 'var': 'transaction.amount' }, 500] }
    ]
  }
});

// Assign policy to agent
guthwine.assignPolicyToAgent(policy.id, agent.id);

// Authorize a transaction
const result = await guthwine.authorize({
  agentDid: agent.did,
  action: 'purchase',
  amount: 99,
  currency: 'USD',
  reason: 'GitHub Copilot subscription'
});

if (result.approved) {
  console.log('Transaction approved!');
  console.log('Mandate token:', result.mandateToken);
} else {
  console.log('Transaction denied:', result.denialReason);
}

// Clean up
guthwine.close();
```

## Configuration Options

```typescript
const guthwine = new DemoService({
  // Path to SQLite database (default: in-memory)
  dbPath: './guthwine.db',
  
  // Enable/disable semantic firewall (default: true)
  enableSemanticFirewall: true,
  
  // LLM simulation latency in ms (default: 800)
  llmLatencyMs: 800,
  
  // Rate limit per minute (default: 60)
  rateLimitPerMinute: 60,
  
  // Default budget limit (default: 10000)
  defaultBudgetLimit: 10000
});
```

## Next Steps

1. **Explore the full API**: See the [README.md](./README.md) for complete documentation
2. **Production deployment**: Use the full `@guthwine/api` package with PostgreSQL and Redis
3. **Custom policies**: Create JSON Logic rules for your specific use case
4. **MCP integration**: Connect to Claude Desktop or other MCP-compatible clients

## Troubleshooting

### "Cannot find module 'better-sqlite3'"

```bash
# Rebuild native modules
pnpm rebuild better-sqlite3
```

### "SQLITE_BUSY: database is locked"

The demo uses WAL mode for concurrent access. If you see this error:
```bash
# Delete the database and restart
rm guthwine_demo.db*
pnpm demo
```

### MCP server not connecting

Ensure the path to the demo package is correct in your Claude Desktop config:
```json
{
  "mcpServers": {
    "guthwine": {
      "command": "node",
      "args": ["/path/to/Guthwine/packages/demo/dist/mcp-server.js"]
    }
  }
}
```

## Support

- GitHub Issues: https://github.com/Oxford22/Guthwine/issues
- Documentation: https://github.com/Oxford22/Guthwine#readme
