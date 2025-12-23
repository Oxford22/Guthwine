# Guthwine V2 - Zero-Knowledge Circuits

This directory contains the Circom circuits for Guthwine's zero-knowledge proof system, implementing **Ed25519 signature verification on BN254** using the **2^85 limb decomposition** optimization.

## Architecture Overview

```
circuits/
├── lib/                    # Core arithmetic libraries
│   └── bigint85.circom     # 2^85 limb BigInt operations
├── ed25519/                # Ed25519 curve operations
│   ├── field.circom        # Field arithmetic (mod p = 2^255 - 19)
│   ├── curve.circom        # Point operations (add, double, scalar mul)
│   └── verify.circom       # Signature verification circuit
├── recursive/              # Recursive proof aggregation
│   └── aggregator.circom   # Groth16-over-Groth16 recursion
├── scripts/                # Build and proving scripts
│   └── compile.sh          # Circuit compilation pipeline
└── test/                   # Test inputs and expected outputs
```

## Mathematical Foundation

### The Cryptographic Divide

Ed25519 uses the curve equation `-x² + y² = 1 + dx²y²` over the prime field `p = 2^255 - 19`.

BN254 (used by Ethereum's precompiles) has a scalar field of order `r ≈ 2^254`.

**Problem:** `p > r`, so a native Ed25519 field element cannot be represented by a single BN254 wire.

### 2^85 Limb Decomposition

Since `255 = 85 × 3`, we represent Ed25519 field elements as exactly **3 limbs of 85 bits**:

```
A = a₀ + a₁·2^85 + a₂·2^170
```

Each limb fits comfortably in BN254's scalar field.

### Modular Reduction Optimization

For Ed25519, we exploit the identity:

```
2^255 ≡ 19 (mod p)
```

When multiplication produces overflow (6 limbs / 510 bits):

```
X = X_low + X_high · 2^255
X ≡ X_low + X_high · 19 (mod p)
```

This transforms expensive division into efficient multiply-by-19 operations.

### Constraint Efficiency

| Operation | Constraints |
|-----------|-------------|
| Field Addition | ~4 |
| Field Multiplication | ~200 |
| Field Squaring | ~180 |
| Modular Reduction | ~50 |
| Point Addition | ~2,000 |
| Point Doubling | ~1,800 |
| Scalar Multiplication (256-bit) | ~500,000 |
| **Full Ed25519 Verify** | **~2,564,061** |

## Circuit Components

### BigInt85 Library (`lib/bigint85.circom`)

Core non-native arithmetic operations:

- `BigInt85Add()` - Addition with carry propagation
- `BigInt85Sub()` - Subtraction with borrow
- `BigInt85Mul()` - Schoolbook multiplication (3×3 → 6 limbs)
- `BigInt85ModReduce()` - Reduction mod p using 2^255 ≡ 19
- `BigInt85ModMul()` - Full modular multiplication
- `BigInt85ModSquare()` - Optimized squaring

### Field Arithmetic (`ed25519/field.circom`)

Field operations over F_p:

- `FieldAdd()` - (a + b) mod p
- `FieldSub()` - (a - b) mod p
- `FieldMul()` - (a × b) mod p
- `FieldSquare()` - a² mod p
- `FieldInv()` - a⁻¹ mod p (via witness + verification)
- `FieldPow(n)` - aⁿ mod p (square-and-multiply)

### Curve Operations (`ed25519/curve.circom`)

Ed25519 point operations in Extended Coordinates (X, Y, Z, T):

- `PointAdd()` - Unified addition formula
- `PointDouble()` - Optimized doubling
- `ScalarMul(n)` - k·P using double-and-add
- `PointCompress()` - Convert to 32-byte format
- `PointDecompressVerify()` - Verify decompression (deferral strategy)

### Signature Verification (`ed25519/verify.circom`)

Main verification circuit:

- `Ed25519Verify()` - Single signature verification
- `Ed25519BatchVerify(n)` - Batch verification
- `HashToScalar()` - SHA-512 to scalar reduction

**Verification Equation:**
```
[s]B = R + [H(R || A || M)]A
```

### Recursive Aggregation (`recursive/aggregator.circom`)

Groth16-over-Groth16 recursion:

- `Groth16Verifier(n)` - Verify inner proofs
- `RecursiveAggregator(n, m)` - Aggregate multiple proofs
- `MerkleRootAggregator(n)` - Compute commitment root
- `GuthwineTransactionProof()` - Full transaction proof

## Usage

### Prerequisites

```bash
# Install Circom 2.1.6+
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
git clone https://github.com/iden3/circom.git
cd circom && cargo build --release
sudo cp target/release/circom /usr/local/bin/

# Install snarkjs
npm install -g snarkjs

# Install rapidsnark (optional, for fast proving)
git clone https://github.com/iden3/rapidsnark.git
cd rapidsnark && npm install && npx task createFieldSources && npx task buildProver
```

### Compile Circuit

```bash
cd circuits
chmod +x scripts/compile.sh

# Compile Ed25519 verification circuit
./scripts/compile.sh compile ed25519/verify.circom
```

### Generate Keys (Trusted Setup)

```bash
# Generate proving and verification keys
./scripts/compile.sh setup verify

# This will:
# 1. Download Powers of Tau (if needed)
# 2. Run Groth16 setup
# 3. Contribute to ceremony
# 4. Export verification key
# 5. Generate Solidity verifier
```

### Generate Proof

```bash
# Create input file
cat > test/input.json << 'EOF'
{
  "pubkey": [...],
  "msgHash": [...],
  "sigR": [...],
  "sigS": [...],
  "pubkeyX": [...],
  "pubkeyY": [...],
  "sigRX": [...],
  "sigRY": [...]
}
EOF

# Generate proof
./scripts/compile.sh prove verify test/input.json
```

### Verify Proof

```bash
./scripts/compile.sh verify verify
```

### Full Pipeline

```bash
./scripts/compile.sh all ed25519/verify.circom test/input.json
```

## On-Chain Verification

The generated `Verifier.sol` can be deployed to Ethereum:

```solidity
// Deploy verifier
Verifier verifier = new Verifier();

// Verify proof on-chain
bool valid = verifier.verifyProof(
    [proof.pi_a[0], proof.pi_a[1]],
    [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]],
    [proof.pi_c[0], proof.pi_c[1]],
    publicInputs
);
```

**Gas Cost:** ~200,000-300,000 gas per verification (regardless of batch size with recursion)

## Benchmarks

| Circuit | Constraints | Proving Time | Proof Size |
|---------|-------------|--------------|------------|
| Single Ed25519 Verify | ~2.5M | ~6s (rapidsnark) | 192 bytes |
| Batch 10 Signatures | ~25M | ~60s | 192 bytes |
| Recursive Aggregation | ~5M | ~12s | 192 bytes |

**Hardware:** AWS c5a.4xlarge (16 vCPU, 32GB RAM)

## Security Considerations

1. **Trusted Setup:** Production deployments MUST use MPC ceremony with multiple participants
2. **Point Decompression:** Uses deferral strategy - uncompressed points are witnesses, compression is verified
3. **Side Channels:** Circuit is constant-time by design
4. **Field Overflow:** All arithmetic includes proper range checks

## References

1. [zk-Ed25519: Underlying Mathematics](https://garvitgoel.medium.com/zk-ed25519-underlying-mathematics-e5e2a0b0d7e5) - Electron Labs
2. [ed25519-circom](https://github.com/Electron-Labs/ed25519-circom) - Reference implementation
3. [Circom Documentation](https://docs.circom.io/)
4. [snarkjs](https://github.com/iden3/snarkjs)

## License

MIT License - See [LICENSE](../LICENSE) for details.
