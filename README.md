# Guthwine v2 - VAGNN Architecture

> **Verifiable Autonomous Graph-Neural Network** - A Sovereign Governance Layer for AI Agents

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

### Enterprise Features (v2)

| Feature | Description |
|---------|-------------|
| **Multi-Tenancy** | Full organization isolation with Row-Level Security |
| **Policy Engine v2** | Inheritance, versioning, simulation, templates |
| **HSM Abstraction** | Local/AWS CloudHSM/GCP Cloud KMS support |
| **Enterprise SSO** | SAML 2.0, OIDC, SCIM 2.0 provisioning |
| **Payment Rails** | Stripe, x402, Plaid connectors with reconciliation |
| **Compliance Module** | EU AI Act impact assessment, human oversight |
| **Observability** | OpenTelemetry tracing, Prometheus metrics, alerting |
| **Real-time Dashboard** | WebSocket updates, D3.js visualizations |

### VAGNN Extensions (Phase 7)

| Module | Capabilities |
|--------|--------------|
| **Zero-Knowledge** | Circom circuits, SnarkJS proofs, batch ECDSA verification, recursive composition |
| **Graph Intelligence** | Neo4j CDC pipeline, Louvain community detection, WCC clustering, fraud alerts |
| **Adversarial Resilience** | Red teaming, prompt injection defense, sandwich defense, perplexity filter |
| **Sovereign Security** | Feldman's VSS, key sharding, emergency recovery council, DKG protocol |
| **Chaos Engineering** | Fault injection, network partition, latency injection, resource exhaustion |
| **Cartesian Merkle** | Non-membership proofs, deterministic structure, ZK-compatible serialization |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Guthwine v2 Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Dashboard  │  │   HTTP API   │  │  MCP Server  │  │     CLI      │ │
│  │   (React)    │  │  (Fastify)   │  │   (stdio)    │  │  (Commander) │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                 │                 │                 │          │
│         └─────────────────┴────────┬────────┴─────────────────┘          │
│                                    │                                     │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │                        Guthwine Service                            │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │  │
│  │  │   Policy    │ │  Semantic   │ │ Delegation  │ │   Payment   │  │  │
│  │  │   Engine    │ │  Firewall   │ │   Chain     │ │    Rails    │  │  │
│  │  │    v2       │ │    (LLM)    │ │   Engine    │ │  Connectors │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │  │
│  │  │    SSO &    │ │ Compliance  │ │Observability│ │    HSM      │  │  │
│  │  │   Access    │ │   Module    │ │   Service   │ │ Abstraction │  │  │
│  │  │   Control   │ │  (AI Act)   │ │  (OTel)     │ │             │  │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                     │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │                         Data Layer                                 │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │  │
│  │  │   PostgreSQL    │  │     Redis       │  │   Merkle Tree   │    │  │
│  │  │   (Prisma+RLS)  │  │   (Cache/PubSub)│  │   (Audit Chain) │    │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- PostgreSQL 15+
- Redis 7+

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

# Seed database (optional)
pnpm db:seed

# Build all packages
pnpm build
```

### Running the Services

```bash
# Start HTTP API server (port 3000)
pnpm start:api

# Start MCP server (stdio)
pnpm start:mcp

# Start Dashboard (port 5173)
pnpm dev:dashboard

# Run all in development mode
pnpm dev
```

## Packages

| Package | Description |
|---------|-------------|
| `@guthwine/core` | Core types, crypto utilities, HSM abstraction, permissions |
| `@guthwine/database` | Prisma schema, PostgreSQL client, Redis cache, RLS |
| `@guthwine/api` | HTTP API server and all business logic services |
| `@guthwine/mcp` | Model Context Protocol server for AI agents |
| `@guthwine/sdk` | TypeScript client SDK |
| `@guthwine/cli` | Command-line interface |
| `@guthwine/dashboard` | React admin dashboard with real-time updates |

## v2 Feature Blocks

### Block A: Database & Multi-tenancy
- PostgreSQL with Row-Level Security (RLS)
- Organization hierarchy with billing
- User roles: OWNER, ADMIN, POLICY_MANAGER, AGENT_OPERATOR, AUDITOR, READONLY
- Scoped API keys with rotation and grace periods

### Block B: Crypto Layer Hardening
- HSM abstraction (local, AWS CloudHSM, GCP Cloud KMS)
- Agent key lifecycle (generation, rotation, revocation)
- Hardened mandate tokens with nonce and introspection
- Delegation token versioning

### Block C: Policy Engine v2
- Policy inheritance (org → team → agent)
- Policy versioning with diff viewer
- Simulation mode (dry-run)
- Policy templates library

### Block D: Payment Rail Connectors
- Stripe integration
- x402 HTTP payment protocol
- Plaid account verification
- Transaction reconciliation engine

### Block E: MCP Server Production Mode
- Multiple transports (stdio, SSE, WebSocket)
- Per-agent rate limiting
- Request signing verification
- Graceful shutdown handling

### Block F: Delegation Chain Engine
- Full chain verification with cryptographic proofs
- Redis-backed chain caching
- D3.js visualization data export
- Chain revocation propagation

### Block G: SSO & Access Control
- SAML 2.0 SP implementation
- OIDC provider integration
- SCIM 2.0 user provisioning
- Fine-grained RBAC with permission matrix

### Block H: Compliance Module
- EU AI Act impact assessment
- Human oversight workflow
- Audit export (JSON, CSV, PDF)
- Data retention policies

### Block I: Observability
- OpenTelemetry tracing integration
- Prometheus metrics endpoint
- Grafana dashboard JSON
- PagerDuty/Slack alerting

### Block J: Deployment & CI/CD
- Multi-stage Dockerfile
- Kubernetes manifests (Deployment, Service, HPA, PDB)
- GitHub Actions workflows (CI, CD, release)
- Helm chart

### Block K: Full Dashboard
- Real-time WebSocket updates
- D3.js delegation chain visualization
- Policy simulation interface
- Comprehensive agent management

## API Reference

### Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "password"}'
```

### Agents

```bash
# Create agent
curl -X POST http://localhost:3000/api/v1/agents \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Shopping Assistant", "type": "AUTONOMOUS"}'

# Freeze agent
curl -X POST http://localhost:3000/api/v1/agents/:id/freeze \
  -H "Authorization: Bearer $TOKEN"
```

### Transactions

```bash
# Authorize transaction
curl -X POST http://localhost:3000/api/v1/transactions/authorize \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "agentId": "agent-id",
    "action": "payment.send",
    "amount": 100,
    "currency": "USD"
  }'
```

### Policies

```bash
# Create policy
curl -X POST http://localhost:3000/api/v1/policies \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Max Transaction Limit",
    "effect": "DENY",
    "rules": { ">": [{"var": "amount"}, 10000] }
  }'

# Simulate policy
curl -X POST http://localhost:3000/api/v1/policies/simulate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"agentId": "agent-id", "action": "payment.send", "amount": 5000}'
```

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/guthwine"

# Redis
REDIS_URL="redis://localhost:6379"

# Security
JWT_SECRET="your-secret-key"
ENCRYPTION_KEY="32-byte-hex-key"

# LLM for Semantic Firewall
OPENAI_API_KEY="sk-..."

# Payment Rails
STRIPE_SECRET_KEY="sk_..."
PLAID_CLIENT_ID="..."
PLAID_SECRET="..."

# SSO
SAML_ENTRY_POINT="https://idp.example.com/sso"
OIDC_ISSUER="https://accounts.google.com"
```

## Deployment

### Docker

```bash
docker build -t guthwine-api --target api .
docker build -t guthwine-mcp --target mcp .
```

### Kubernetes

```bash
helm install guthwine ./deploy/helm/guthwine \
  --namespace guthwine \
  --create-namespace
```

### CI/CD

GitHub Actions workflows are provided in `docs/workflows/`:
- `ci.yml` - Lint, test, security scan, Docker build
- `cd.yml` - Staging/production deployment with canary
- `release.yml` - Versioning, changelog, publishing

Copy to `.github/workflows/` to activate.

## Security

### Cryptographic Standards

- **Key Generation**: Ed25519 for agent identity
- **Token Signing**: ES256 (ECDSA with P-256)
- **Encryption**: AES-256-GCM for sensitive data
- **Hashing**: SHA-256 for Merkle tree

### Kill Switch Hierarchy

1. **Agent-Level**: Freeze individual agents
2. **Organization-Level**: Freeze all agents in an organization
3. **Global-Level**: Emergency freeze of all transactions

## License

MIT License - see [LICENSE](LICENSE) for details.

---

*"In the hands of a worthy bearer, Guthwine never fails."*
