# Guthwine v2

> **Sovereign Governance Layer for AI Agents**

Guthwine is a production-grade, multi-tenant authorization and governance system for AI agents. It provides cryptographic identity, hierarchical delegation, policy-based transaction authorization, semantic risk assessment, and comprehensive audit trails.

Named after the legendary sword of King Éomer of Rohan, Guthwine ("battle-friend") serves as the trusted guardian between AI agents and the actions they take on behalf of humans.

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Agent Identity** | DID-based identity with Ed25519 cryptographic key pairs |
| **Transaction Authorization** | Policy-based approval using JSON Logic rules |
| **Hierarchical Delegation** | JWT-based permission delegation with constraint inheritance |
| **Audit Trail** | Immutable ledger with Merkle tree verification |
| **Rate Limiting** | Sliding window limits with anomaly detection |
| **Semantic Firewall** | LLM-based risk assessment for transaction reasoning |
| **Kill Switch** | Instant freeze at agent, organization, or global level |

### Enterprise Features

- **Multi-Tenancy**: Full organization isolation with RBAC
- **Enterprise SSO**: SAML 2.0 and OIDC integration
- **Payment Rails**: Stripe, Plaid, and crypto wallet connectors
- **Compliance**: GDPR data export, SOC 2 audit reports
- **Observability**: Prometheus metrics, distributed tracing
- **Chaos Engineering**: Built-in fault injection for resilience testing

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Guthwine v2                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Dashboard  │  │   HTTP API  │  │  MCP Server │             │
│  │   (React)   │  │  (Fastify)  │  │   (stdio)   │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│  ┌──────┴────────────────┴────────────────┴──────┐             │
│  │              Guthwine Service                  │             │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐         │             │
│  │  │ Policy  │ │Semantic │ │Delegation│         │             │
│  │  │ Engine  │ │Firewall │ │ Service  │         │             │
│  │  └─────────┘ └─────────┘ └─────────┘         │             │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐         │             │
│  │  │  Auth   │ │Compliance│ │ Payment │         │             │
│  │  │ Service │ │ Service  │ │  Rails  │         │             │
│  │  └─────────┘ └─────────┘ └─────────┘         │             │
│  └───────────────────┬───────────────────────────┘             │
│                      │                                          │
│  ┌───────────────────┴───────────────────────────┐             │
│  │                  Database                      │             │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐       │             │
│  │  │ Prisma  │  │  Redis  │  │ Merkle  │       │             │
│  │  │(Postgres)│ │ (Cache) │  │  Tree   │       │             │
│  │  └─────────┘  └─────────┘  └─────────┘       │             │
│  └───────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose (for local development)
- PostgreSQL 15+ (or use Docker)
- Redis 7+ (optional, for caching)

### Installation

```bash
# Clone the repository
git clone https://github.com/Oxford22/Guthwine.git
cd Guthwine

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Start infrastructure (PostgreSQL + Redis)
docker-compose up -d

# Generate Prisma client
pnpm db:generate

# Run database migrations
pnpm db:push

# Build all packages
pnpm build
```

### Running the Services

```bash
# Start HTTP API server (port 3000)
pnpm start:api

# Start MCP server (stdio)
pnpm start:mcp

# Start Dashboard (port 3001)
pnpm start:dashboard

# Run all in development mode
pnpm dev
```

## Packages

| Package | Description |
|---------|-------------|
| `@guthwine/core` | Core types, crypto utilities, and shared code |
| `@guthwine/database` | Prisma schema, database client, Redis cache |
| `@guthwine/api` | HTTP API server and all business logic services |
| `@guthwine/mcp` | Model Context Protocol server for AI agents |
| `@guthwine/sdk` | TypeScript client SDK |
| `@guthwine/cli` | Command-line interface |
| `@guthwine/dashboard` | React admin dashboard |

## Usage

### TypeScript SDK

```typescript
import { createClient } from '@guthwine/sdk';

const client = createClient('http://localhost:3000', 'your-api-key');

// Create an agent
const agent = await client.createAgent({
  name: 'Shopping Assistant',
  type: 'PRIMARY',
});

// Authorize a transaction
const result = await client.authorizeTransaction({
  agentId: agent.id,
  amount: 99.99,
  currency: 'USD',
  merchantId: 'amazon',
  merchantName: 'Amazon',
  reasoningTrace: 'User requested to purchase a book for their reading list',
});

if (result.status === 'APPROVED') {
  console.log('Transaction approved!');
  console.log('Mandate token:', result.mandateToken);
}
```

### CLI

```bash
# Configure the CLI
guthwine config

# List agents
guthwine agents list

# Authorize a transaction
guthwine tx authorize -a <agent-id> --amount 50 -m amazon

# Freeze an agent
guthwine agents freeze <agent-id> -r "Suspicious activity"

# View audit logs
guthwine compliance audit -l 20
```

### MCP Integration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "guthwine": {
      "command": "npx",
      "args": ["@guthwine/mcp"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

## API Reference

### Agents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agents` | POST | Create a new agent |
| `/v1/agents` | GET | List all agents |
| `/v1/agents/:id` | GET | Get agent details |
| `/v1/agents/:id/freeze` | POST | Freeze an agent |
| `/v1/agents/:id/unfreeze` | POST | Unfreeze an agent |
| `/v1/agents/:id/blast-radius` | GET | Calculate blast radius |

### Transactions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/transactions/authorize` | POST | Authorize a transaction |
| `/v1/transactions/:id` | GET | Get transaction details |
| `/v1/transactions/:id/execute` | POST | Execute an approved transaction |
| `/v1/transactions/:id/explain` | GET | Get decision explanation |

### Delegations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/delegations` | POST | Create a delegation |
| `/v1/delegations/:id` | GET | Get delegation details |
| `/v1/delegations/:id/revoke` | POST | Revoke a delegation |
| `/v1/delegations/tree` | GET | Get delegation tree |

### Policies

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/policies` | POST | Create a policy |
| `/v1/policies` | GET | List all policies |
| `/v1/policies/:id` | PUT | Update a policy |
| `/v1/policies/:id` | DELETE | Delete a policy |

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/guthwine"

# Redis (optional)
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="your-secret-key"
ENCRYPTION_KEY="32-byte-hex-key"

# LLM for Semantic Firewall
OPENAI_API_KEY="sk-..."
LLM_MODEL="gpt-4.1-mini"

# Payment Rails (optional)
STRIPE_SECRET_KEY="sk_..."
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."

# SSO (optional)
SAML_ENTRY_POINT="https://idp.example.com/sso"
OIDC_ISSUER="https://accounts.google.com"
```

## Security

### Cryptographic Guarantees

- **Agent Identity**: Ed25519 key pairs with DID identifiers
- **Delegation Tokens**: JWT with RS256 signatures and constraint embedding
- **Audit Trail**: SHA-256 Merkle tree linking for tamper detection
- **Secrets**: AES-256-GCM encryption at rest

### Kill Switch Hierarchy

1. **Agent-Level**: Freeze individual agents
2. **Organization-Level**: Freeze all agents in an organization
3. **Global-Level**: Emergency freeze of all transactions system-wide

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

*"In the hands of a worthy bearer, Guthwine never fails."*
