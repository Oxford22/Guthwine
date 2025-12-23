# Guthwine

**Sovereign Governance Layer for AI Agents**

Guthwine is a comprehensive authorization, delegation, and audit system designed for AI agents. It provides a robust framework for managing agent identities, authorizing transactions, delegating permissions, and maintaining an immutable audit trail.

## Features

- **Agent Identity Management** - DID-based identity with cryptographic key pairs
- **Transaction Authorization** - Policy-based approval system with JSON Logic rules
- **Hierarchical Delegation** - JWT-based permission delegation with constraint inheritance
- **Immutable Audit Trail** - Merkle tree verified ledger for tamper detection
- **Rate Limiting** - Configurable spending limits with anomaly detection
- **Semantic Firewall** - LLM-based risk assessment for transaction reasoning
- **MCP Integration** - Model Context Protocol server for AI agent communication
- **REST API** - Fastify-based HTTP API for direct integration

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/Oxford22/Guthwine.git
cd Guthwine

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Push database schema
npm run db:push

# Build the project
npm run build
```

### Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
DATABASE_URL="file:./dev.db"
GUTHWINE_MASTER_KEY="your-secure-master-key"
GUTHWINE_JWT_SECRET="your-jwt-secret"
OPENAI_API_KEY="your-openai-api-key"  # Optional, for semantic firewall
```

### Running

```bash
# Run the HTTP server
npm run start:http

# Run the MCP server
npm run start:mcp

# Run tests
npm test

# Run the example
npm run example
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Guthwine Service                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Identity  │  │  Delegation │  │     Policy Engine       │  │
│  │   Service   │  │   Service   │  │   (JSON Logic + LLM)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │    Vault    │  │    Ledger   │  │    Semantic Firewall    │  │
│  │   Service   │  │   Service   │  │    (Risk Assessment)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      Rate Limiter                           ││
│  └─────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────┤
│                         Prisma ORM                              │
├─────────────────────────────────────────────────────────────────┤
│                    SQLite / PostgreSQL                          │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### Basic Usage

```typescript
import { GuthwineService, PolicyEngine } from 'guthwine';

// Initialize
const guthwine = new GuthwineService({
  enableSemanticFirewall: true,
  enableRateLimiting: true,
  enableSemanticPolicyCheck: true,
});

await guthwine.initialize();

// Register an agent
const agent = await guthwine.registerAgent({
  name: 'Shopping Agent',
  description: 'AI agent for e-commerce purchases',
});

// Add a policy
await guthwine.addPolicy(
  agent.did,
  'Max Transaction $500',
  PolicyEngine.POLICY_TEMPLATES.maxAmount(500)
);

// Authorize a transaction
const result = await guthwine.requestTransactionSignature(
  agent.did,
  {
    amount: 150,
    currency: 'USD',
    merchantId: 'amazon_001',
    merchantName: 'Amazon',
    reasoningTrace: 'Purchasing office supplies for the team',
  }
);

if (result.decision === 'ALLOW') {
  console.log('Transaction approved:', result.mandate);
} else {
  console.log('Transaction denied:', result.reason);
}
```

### Delegation

```typescript
// Issue delegation to a sub-agent
const delegation = await guthwine.issueDelegation(
  parentAgent.did,
  childAgent.did,
  {
    maxAmount: 200,
    allowedCategories: ['office', 'software'],
    semanticConstraints: 'Only sustainable products',
    expiresIn: 3600, // 1 hour
  }
);

// Child agent uses delegation
const result = await guthwine.requestTransactionSignature(
  childAgent.did,
  transaction,
  [delegation.token] // Delegation chain
);
```

### Policy Templates

```typescript
// Maximum amount
PolicyEngine.POLICY_TEMPLATES.maxAmount(500)

// Allowed currencies
PolicyEngine.POLICY_TEMPLATES.allowedCurrencies(['USD', 'EUR'])

// Business hours only
PolicyEngine.POLICY_TEMPLATES.businessHoursOnly()

// Blocked merchants
PolicyEngine.POLICY_TEMPLATES.blockedMerchants(['casino_123'])

// Allowed categories
PolicyEngine.POLICY_TEMPLATES.allowedCategories(['office', 'software'])
```

## API Reference

### HTTP Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/agents` | Register a new agent |
| GET | `/agents/:did` | Get agent information |
| POST | `/agents/:did/freeze` | Freeze an agent |
| POST | `/agents/:did/unfreeze` | Unfreeze an agent |
| POST | `/transactions/authorize` | Authorize a transaction |
| POST | `/delegations` | Issue a delegation |
| DELETE | `/delegations/:tokenHash` | Revoke a delegation |
| POST | `/agents/:did/policies` | Add a policy |
| GET | `/agents/:did/policies` | Get agent policies |
| GET | `/audit` | Get audit trail |
| GET | `/audit/verify` | Verify audit integrity |
| POST | `/global/freeze` | Set global freeze |

### MCP Tools

- `request_transaction_signature` - Authorize a transaction
- `register_agent` - Register a new agent
- `issue_delegation` - Issue a delegation token
- `revoke_delegation` - Revoke a delegation
- `freeze_agent` - Freeze an agent (kill switch)
- `unfreeze_agent` - Unfreeze an agent
- `add_policy` - Add a policy rule
- `get_policies` - Get agent policies
- `get_audit_trail` - Get audit trail
- `verify_audit_integrity` - Verify audit integrity
- `get_agent_info` - Get agent information
- `store_secret` - Store a secret in the vault
- `get_rate_limit_status` - Get rate limit status
- `set_global_freeze` - Set global freeze state

## Security Considerations

1. **Master Key** - Store securely, never commit to version control
2. **JWT Secret** - Use a strong, unique secret for mandate signing
3. **Database** - Use PostgreSQL in production with proper access controls
4. **API Keys** - Store in the encrypted vault, not in code
5. **Rate Limits** - Configure appropriate limits for your use case
6. **Audit Trail** - Regularly verify integrity with Merkle tree verification

## License

MIT
