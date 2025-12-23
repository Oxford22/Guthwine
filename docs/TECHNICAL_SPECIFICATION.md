
# Guthwine V2: Technical Specification

**Version 2.1 | December 2024**

**Author**: Manus AI

**Status**: Final

---

## 1. Introduction

### 1.1 Purpose

This document provides a comprehensive technical specification for the Guthwine V2 system. It details the system architecture, cryptographic primitives, service components, operational procedures, and security considerations. It is intended for software engineers, security auditors, and system architects involved in the development, deployment, and maintenance of the Guthwine platform.

This specification serves as the canonical source of truth for the system's design and implementation, expanding upon the theoretical foundations laid out in the *Guthwine V2 Whitepaper* [1].

### 1.2 Scope

This document covers all components within the Guthwine V2 monorepo, including:

- Core cryptographic libraries
- Database schema and data models
- API services and business logic
- Zero-knowledge circuits and proving systems
- Frontend dashboard and user interfaces
- Command-line interface (CLI) and Software Development Kit (SDK)
- Deployment, operations, and testing infrastructure

### 1.3 Definitions

| Term | Definition |
|------|------------|
| **Agent** | An autonomous software entity, identified by a Decentralized Identifier (DID), capable of executing transactions. |
| **VAGNN** | Verifiable Autonomous Graph-Neural Network. The core fraud detection and compliance engine. |
| **2^85 Limb Decomposition** | The core cryptographic technique for non-native field arithmetic, enabling Ed25519 verification in BN254 circuits. |
| **Recursive zk-SNARK** | A zero-knowledge proof that attests to the validity of other proofs, enabling O(1) batch verification. |
| **CDC** | Change Data Capture. A design pattern for tracking and propagating data changes in real-time. |
| **RLS** | Row-Level Security. A database feature that restricts data access on a per-user, per-row basis. |
| **MPC** | Multi-Party Computation. A cryptographic protocol used for secure trusted setups. |
| **VSS** | Verifiable Secret Sharing. A cryptographic scheme for securely distributing and recovering secrets. |

---

## 2. System Architecture

### 2.1 High-Level Overview

Guthwine V2 is a multi-tenant, cloud-native application designed for high availability, scalability, and security. It is architected as a monorepo containing multiple independent but interoperable packages.

**Architectural Pillars:**

1.  **Cryptographic Convergence**: Unifying disparate cryptographic standards (Ed25519, BN254) through zero-knowledge proofs.
2.  **Privacy-Preserving Compliance**: Leveraging Graph Neural Networks and ZK-ML to meet regulatory requirements without exposing sensitive data.
3.  **Real-Time Governance**: Utilizing a Change Data Capture (CDC) pipeline and WebSockets for sub-second state synchronization.
4.  **Verifiable Resilience**: Employing Chaos Engineering to systematically validate the system's fault tolerance.

![System Architecture Diagram](https://example.com/system_architecture.png) <!-- Placeholder for diagram -->

### 2.2 Monorepo Structure

The system is organized as a `pnpm` workspace and managed by `turborepo` for build orchestration.

```
Guthwine/
├── circuits/               # Circom ZK circuits
├── docs/                   # Documentation (Whitepaper, Tech Spec)
├── packages/
│   ├── core/               # Types, crypto, ZK, VSS, permissions
│   ├── database/           # Prisma schema, PostgreSQL, Redis
│   ├── api/                # Fastify HTTP server, all services
│   ├── mcp/                # MCP server (stdio/SSE/WebSocket)
│   ├── sdk/                # TypeScript client SDK
│   ├── cli/                # Command-line interface
│   ├── dashboard/          # React admin dashboard
│   └── demo/               # Zero-dependency demo engine
├── deploy/
│   ├── kubernetes/         # K8s manifests
│   ├── helm/               # Helm chart
│   └── chaos-mesh/         # Chaos Mesh CRDs
├── docker-compose.yml      # Local development environment
├── Dockerfile              # Multi-stage production Dockerfile
└── README.md
```

### 2.3 Package Overview

| Package | Description | Key Technologies |
|---------|-------------|------------------|
| `@guthwine/core` | Shared types, cryptographic utilities, and ZK primitives. | Zod, Ed25519, JWT, Circom, SnarkJS |
| `@guthwine/database` | Data models, migrations, and database clients. | Prisma, PostgreSQL, Redis, RLS |
| `@guthwine/api` | Main application logic, REST API, and all backend services. | Fastify, OpenTelemetry, Neo4j |
| `@guthwine/mcp` | Model Context Protocol server for AI agent integration. | MCP, stdio, WebSocket, SSE |
| `@guthwine/sdk` | TypeScript client library for browser and Node.js. | Axios, Zod |
| `@guthwine/cli` | Command-line interface for administration and operations. | Commander.js, Inquirer.js |
| `@guthwine/dashboard` | Web-based administrative UI. | React, Vite, TailwindCSS, D3.js, Graphology |
| `@guthwine/demo` | Zero-dependency engine for quick starts and testing. | better-sqlite3, ioredis-mock |

---



## 3. Cryptographic Primitives

### 3.1 Ed25519 Signature Verification in Circom

**Objective**: Verify Ed25519 signatures within a BN254-based zk-SNARK circuit to bridge Solana/Cosmos ecosystems with EVM chains.

**Core Technique**: 2^85 limb decomposition.

1.  **Representation**: An Ed25519 field element (255 bits) is represented as three 85-bit limbs. Each limb fits within the BN254 scalar field.
    ```
    A = a₀ + a₁·2^85 + a₂·2^170
    ```

2.  **Modular Reduction**: Multiplication of two 3-limb numbers results in a 6-limb number. Reduction modulo `p = 2^255 - 19` is achieved by exploiting the identity `2^255 ≡ 19 (mod p)`. This avoids expensive division in the circuit.

3.  **Point Decompression Deferral**: The uncompressed Ed25519 public key `(x, y)` is provided as a private witness. The circuit re-compresses it and asserts equality with the public compressed key, saving a modular square root operation.

**Implementation**: See `circuits/ed25519/`.

| Circuit | Constraints | Description |
|---------|-------------|-------------|
| `BigInt85ModMul` | ~200 | Modular multiplication of two 3-limb numbers. |
| `PointAdd` | ~2,000 | Addition of two Ed25519 points in extended coordinates. |
| `ScalarMul` | ~500,000 | 256-bit scalar multiplication. |
| `Ed25519Verify` | ~2,564,061 | Full signature verification. |

### 3.2 Recursive zk-SNARKs

**Objective**: Achieve O(1) on-chain verification cost for batch operations.

**Technique**: Groth16-over-Groth16 recursion.

1.  **Inner Proofs**: Individual proofs are generated for each Ed25519 signature using the `Ed25519Verify` circuit.
2.  **Outer Proof**: A recursive `aggregator.circom` circuit verifies multiple inner proofs. The verifier for the inner proof is implemented in Circom.
3.  **Root Proof**: The process is repeated until a single root proof is generated, which is then verified on-chain.

**Economic Impact**: Reduces the gas cost of verifying 100 signatures from ~50,000,000 gas to ~300,000 gas, a **166x improvement**.

### 3.3 MPC Trusted Setup

**Objective**: Securely generate the parameters for the Groth16 proving system.

**Implementation**: `packages/core/src/zk/ceremony/trusted-setup.ts`

1.  **Phase 1 (Powers of Tau)**: Universal setup, independent of the circuit. The script uses publicly available perpetual powers of tau files.
2.  **Phase 2 (Circuit-Specific)**: Multi-party computation ceremony where multiple participants contribute randomness. The system is secure if at least one participant is honest and discards their entropy.
3.  **Automation**: The script automates participant coordination, contribution verification, and final `.zkey` generation.

### 3.4 Verifiable Secret Sharing (VSS)

**Objective**: Enable decentralized, threshold-based recovery of critical secrets (e.g., master agent keys).

**Technique**: Feldman's Verifiable Secret Sharing.

1.  **Sharing**: A secret `s` is encoded into a polynomial `P(x)` of degree `t-1`. Shares `(xᵢ, P(xᵢ))` are distributed to `n` participants.
2.  **Verification**: A cryptographic commitment to the polynomial coefficients `g^aᵢ` allows participants to verify their shares are consistent without revealing the polynomial.
3.  **Reconstruction**: Any `t` participants can combine their shares to reconstruct the polynomial and recover the secret `s = P(0)` using Lagrange interpolation.

**Implementation**: `packages/core/src/crypto/vss/feldman-vss.ts`.

---

## 4. Data Models and Storage

### 4.1 PostgreSQL Schema

The primary data store is a PostgreSQL database, managed via Prisma ORM. The schema is defined in `packages/database/prisma/schema.prisma`.

**Key Models**:

| Model | Description | Key Relations |
|---|---|---|
| `Organization` | Represents a tenant in the multi-tenant system. | Has many `User`, `Agent`, `Policy`. |
| `User` | Represents a human operator with roles and permissions. | Belongs to `Organization`. |
| `Agent` | Represents an autonomous AI agent. | Belongs to `Organization`, has many `PolicyAssignment`. |
| `Policy` | A JSON Logic rule set defining transaction constraints. | Belongs to `Organization`. |
| `PolicyAssignment` | Links a `Policy` to an `Agent` with a priority. | --- |
| `DelegationToken` | A JWT representing delegated permissions. | Issued by `User` or `Agent`, granted to `Agent`. |
| `Transaction` | A record of a proposed or executed transaction. | Initiated by `Agent`. |
| `AuditLog` | An immutable, Merkle-chained log of all system events. | Linked to `Transaction`, `User`, `Agent`. |
| `ApiKey` | A scoped API key for programmatic access. | Belongs to `User`. |
| `ComplianceReport` | A record of a compliance assessment (e.g., AI Act). | Linked to `Transaction`. |

### 4.2 Row-Level Security (RLS)

**Objective**: Enforce strict data isolation between tenants at the database level.

**Implementation**: `packages/database/prisma/migrations/`

- A PostgreSQL policy is applied to every table containing an `organizationId` column.
- The policy ensures that a query can only access rows where the `organizationId` matches the `guthwine.current_organization_id` session variable.
- This session variable is set for the duration of a transaction using the database context helper (`packages/database/src/context.ts`).

```sql
-- Example RLS Policy for the Agent table
ALTER TABLE "Agent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_rls_policy" ON "Agent"
  FOR ALL
  USING ("organizationId" = current_setting("guthwine.current_organization_id")::uuid);
```

### 4.3 Redis

**Objective**: Caching, rate limiting, and real-time messaging.

**Implementation**: `packages/database/src/redis.ts`

- **Caching**: Caches frequently accessed, immutable data (e.g., verified delegation chains).
- **Rate Limiting**: Implements a sliding window rate limiter for API endpoints and MCP requests.
- **Pub/Sub**: Used by the CDC WebSocket service to broadcast real-time updates.
- **Mocking**: The `@guthwine/demo` package uses `ioredis-mock` for a zero-dependency setup.

### 4.4 Neo4j Graph Database

**Objective**: Model and analyze complex relationships for fraud detection and compliance.

**Implementation**: `packages/api/src/services/graph-intelligence/`

- **Schema**: Nodes for `Agent`, `Transaction`, `Organization`, `User`. Relationships for `DELEGATES`, `EXECUTES`, `BELONGS_TO`.
- **Data Ingestion**: A Change Data Capture (CDC) pipeline listens for changes in the PostgreSQL database and propagates them to Neo4j in real-time.
- **Analytics**: Used by the VAGNN engine to run community detection (Louvain) and connectivity (WCC) algorithms.

---



---

## 5. Backend Services

The backend is a monolithic API service built with Fastify, located in the `@guthwine/api` package. It exposes a REST API and a WebSocket interface.

### 5.1 Core Services

| Service | Description |
|---|---|
| `GuthwineService` | The main orchestrator, handling agent registration, transaction authorization, and delegation. |
| `PolicyEngineV2` | Evaluates transaction requests against a hierarchical policy structure (org → team → agent) using JSON Logic. Supports versioning and simulation. |
| `DelegationChainEngine` | Verifies and caches chains of delegation tokens, checking for cycles and scope escalation. |
| `AuthService` | Manages user authentication, enterprise SSO (SAML/OIDC), and SCIM user provisioning. |
| `ComplianceModule` | Handles AI Act impact assessments, human oversight workflows, and audit data exports. |

### 5.2 VAGNN and Fraud Detection

**Objective**: Detect and prevent fraudulent activity using Graph Neural Networks.

**Implementation**: `packages/api/src/services/graph-intelligence/`

1.  **Semantic Firewall**: A pre-execution check that uses an LLM to analyze the natural language `reason` for a transaction, detecting social engineering tactics (e.g., urgency, impersonation).
2.  **Graph Analysis**: The `fraud-detection.ts` service uses the Neo4j database to:
    *   Run **Louvain Modularity** to detect tightly-knit communities of colluding agents.
    *   Run **Weakly Connected Components (WCC)** to identify isolated clusters engaging in synthetic activity.
    *   Calculate **PageRank** to determine the influence of an agent within the graph.
3.  **Risk Scoring**: A composite risk score is generated based on semantic analysis, graph topology, and transaction velocity.

### 5.3 Adversarial Resilience

**Objective**: Proactively test and defend against attacks on the AI and governance layers.

**Implementation**: `packages/api/src/services/red-teaming/`

1.  **Sandwich Defense**: Isolates user-provided input from the system prompt sent to the LLM by placing it between instruction templates, preventing prompt injection.
2.  **Perplexity Filter**: Measures the perplexity of an LLM's response. A low perplexity (highly predictable) response can indicate a coerced or jailbroken state.
3.  **Automated Fuzzing**: The `RedTeamEngine` systematically generates mutated and adversarial prompts to test the resilience of the semantic firewall.

### 5.4 Real-Time Infrastructure

**Objective**: Ensure sub-second propagation of state changes.

**Implementation**: `packages/api/src/services/cdc-websocket/`

1.  **CDC Listener**: A service listens to the PostgreSQL logical replication slot.
2.  **Event Bus**: Changes are published to a Redis pub/sub channel.
3.  **WebSocket Push**: The `CdcStreamService` subscribes to the Redis channel and pushes relevant updates to connected clients (e.g., the dashboard) via a Fastify WebSocket connection.

### 5.5 Observability and Chaos Engineering

**Objective**: Ensure production resilience and debuggability.

-   **Observability** (`observability-service.ts`): Integrates with OpenTelemetry for distributed tracing and Prometheus for metrics scraping.
-   **Chaos Engineering** (`chaos-service.ts`): Provides an API for controlled fault injection (e.g., latency, errors) to test system behavior under adverse conditions.

---

## 6. Frontend and Interfaces

### 6.1 Admin Dashboard

**Objective**: Provide a comprehensive UI for administration, monitoring, and operations.

**Implementation**: `packages/dashboard`

-   **Framework**: React with Vite, written in TypeScript.
-   **Styling**: TailwindCSS with a custom design system.
-   **State Management**: Zustand for simple, hook-based state management.
-   **Data Fetching**: React Query (`@tanstack/react-query`) for server state management, caching, and refetching.
-   **Real-Time Updates**: The dashboard connects to the API's CDC WebSocket stream to receive and display live updates without polling.
-   **Client-Side Graphology**: For the delegation chain visualization, the dashboard uses `graphology` and `d3.js`. The computationally intensive Louvain community detection is offloaded to a Web Worker (`packages/dashboard/src/workers/louvain.worker.ts`) to keep the main UI thread responsive.

### 6.2 Command-Line Interface (CLI)

**Objective**: Enable headless administration, scripting, and automation.

**Implementation**: `packages/cli`

-   **Framework**: `commander.js` for command parsing and `inquirer.js` for interactive prompts.
-   **Functionality**: Provides commands for managing organizations, users, agents, policies, and running compliance reports.
-   **Demo Mode**: The `@guthwine/demo` package includes a specialized, interactive CLI that guides users through a series of pre-defined scenarios to showcase the system's capabilities.

### 6.3 Software Development Kit (SDK)

**Objective**: Provide a simple, typed interface for programmatic interaction with the Guthwine API.

**Implementation**: `packages/sdk`

-   **Language**: TypeScript, providing type safety for all API interactions.
-   **HTTP Client**: `axios` for handling HTTP requests.
-   **Schema Validation**: Uses `Zod` schemas (shared with the `@guthwine/core` package) to validate API responses at runtime, ensuring data integrity.

### 6.4 Model Context Protocol (MCP) Server

**Objective**: Allow AI agents (e.g., running in Claude Desktop) to interact with Guthwine using their native protocol.

**Implementation**: `packages/mcp`

-   **Transports**: Supports multiple transports for flexibility:
    -   `stdio`: For local, single-agent interaction.
    -   `WebSocket`: For remote, persistent connections.
    -   `Server-Sent Events (SSE)`: For one-way, real-time data streams.
-   **Request Signing**: The MCP server verifies that incoming requests are cryptographically signed by the agent's DID key, ensuring authenticity.

---

## 7. Deployment and Operations

### 7.1 Containerization

**Objective**: Package the application and its dependencies into a portable, reproducible format.

**Implementation**: A multi-stage `Dockerfile` is provided in the root directory.

1.  **Builder Stage**: Installs `pnpm`, copies all source code, and runs `pnpm install` and `pnpm build` to compile all packages.
2.  **Runner Stage**: A slim Node.js image copies only the compiled `dist` directories, `node_modules`, and `package.json` files from the builder stage. This results in a smaller, more secure production image by excluding build tools and source code.

### 7.2 Kubernetes Deployment

**Objective**: Orchestrate the deployment, scaling, and management of the Guthwine application in a production environment.

**Implementation**: `deploy/kubernetes/` and `deploy/helm/`

-   **Manifests**: Standard Kubernetes manifests are provided for `Deployment`, `Service`, `ConfigMap`, and `Secret`.
-   **Helm Chart**: A Helm chart is provided for simplified, configurable deployments. It manages dependencies (e.g., PostgreSQL, Redis) and allows for easy customization of resource limits, replicas, and environment variables.
-   **Horizontal Pod Autoscaler (HPA)**: The deployment is configured to automatically scale the number of API server pods based on CPU and memory utilization.

### 7.3 CI/CD

**Objective**: Automate the testing, building, and deployment of the application.

**Implementation**: GitHub Actions workflows are defined in `docs/workflows/` (to be copied to `.github/workflows/`).

| Workflow | Trigger | Actions |
|---|---|---|
| `ci.yml` | Push to `main` or Pull Request | 1. Lint code. 2. Run unit tests. 3. Build all packages. |
| `cd.yml` | Push to `main` (if CI passes) | 1. Build and push Docker image to registry. 2. Deploy to staging environment using Helm. |
| `release.yml` | Manual trigger | 1. Create a new Git tag. 2. Deploy to production environment. 3. Create a GitHub Release with automated changelog. |

### 7.4 Chaos Engineering

**Objective**: Systematically verify the resilience of the system under turbulent conditions.

**Implementation**: `deploy/chaos-mesh/`

-   **Framework**: Uses Chaos Mesh, a cloud-native chaos engineering platform for Kubernetes.
-   **CRDs**: Custom Resource Definitions are provided for various chaos experiments:
    -   `NetworkChaos`: To simulate latency, packet loss, and network partitions between the API server and the database.
    -   `PodChaos`: To randomly kill pods and test leader election and self-healing capabilities.
    -   `Workflow`: To orchestrate complex failure scenarios, such as a cascading failure during a database failover.
-   **Hypothesis Testing**: Each chaos experiment is designed to test a specific hypothesis (e.g., "The system will maintain data consistency during a network partition of up to 30 seconds").

---

## 8. Security Considerations

### 8.1 Authentication and Authorization

-   **User Authentication**: Handled by the `AuthService`, supporting both local password-based auth (with bcrypt hashing) and enterprise SSO (SAML/OIDC).
-   **API Authentication**: Scoped API keys with expiration and rotation are used for programmatic access.
-   **Agent Authentication**: All agent interactions (MCP requests) must be signed with the agent's Ed25519 key.
-   **RBAC**: A fine-grained Role-Based Access Control system, defined in the compile-time checked permission matrix (`packages/core/src/permissions/matrix.ts`), governs all user actions.

### 8.2 Data Security

-   **Data in Transit**: All communication is encrypted with TLS 1.3.
-   **Data at Rest**: Sensitive data in the PostgreSQL database (e.g., API keys, secrets) is encrypted at the application layer before being written to the database.
-   **Tenant Isolation**: Row-Level Security (RLS) provides a hard guarantee of data separation between tenants.

### 8.3 Cryptographic Security

-   **Trusted Setup**: Production deployments require a multi-party computation ceremony for the ZK-SNARK trusted setup to mitigate the risk of a compromised or malicious setup coordinator.
-   **Side Channels**: All cryptographic operations, especially within Circom circuits, are designed to be constant-time to prevent timing-based side-channel attacks.
-   **Randomness**: Cryptographically secure pseudo-random number generators (CSPRNGs) are used for all key generation and nonce creation.

### 8.4 AI and Governance Security

-   **Prompt Injection**: The Sandwich Defense mechanism is the primary defense against prompt injection attacks on the semantic firewall.
-   **Policy Bypass**: The hierarchical policy engine ensures that restrictive organizational policies cannot be overridden by more permissive agent-level policies.
-   **Delegation Abuse**: The `DelegationChainEngine` prevents scope escalation and detects circular delegation paths.

---

## 9. References

[1] Guthwine V2 Whitepaper. (2024). *Cryptographic Convergence for the Regulated Agentic Economy*. [docs/whitepaper/WHITEPAPER.md](whitepaper/WHITEPAPER.md)

[2] Circom Language Documentation. *iden3*. [https://docs.circom.io/](https://docs.circom.io/)

[3] SnarkJS Documentation. *iden3*. [https://github.com/iden3/snarkjs](https://github.com/iden3/snarkjs)

[4] Feldman, P. (1987). *A practical scheme for non-interactive verifiable secret sharing*. In Proceedings of the 28th Annual Symposium on Foundations of Computer Science.

[5] Groth, J. (2016). *On the Size of Pairing-based Non-interactive Arguments*. In EUROCRYPT 2016.

[6] Chaos Mesh Documentation. *Chaos Mesh Authors*. [https://chaos-mesh.org/docs/](https://chaos-mesh.org/docs/)

