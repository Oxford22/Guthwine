#!/bin/bash

# Guthwine V2 - Circuit Compilation Script
# 
# This script compiles Circom circuits and generates proving/verification keys.
# 
# Prerequisites:
# - circom 2.1.6+
# - snarkjs
# - Node.js 18+
# - Powers of Tau file (ptau)

set -e

CIRCUITS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_DIR="$CIRCUITS_DIR/ptau"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create directories
mkdir -p "$BUILD_DIR"
mkdir -p "$PTAU_DIR"

# Download Powers of Tau if not present
download_ptau() {
    local power=$1
    local ptau_file="$PTAU_DIR/powersOfTau28_hez_final_$power.ptau"
    
    if [ ! -f "$ptau_file" ]; then
        log_info "Downloading Powers of Tau (2^$power)..."
        curl -L "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_$power.ptau" \
            -o "$ptau_file"
    else
        log_info "Powers of Tau (2^$power) already exists"
    fi
    
    echo "$ptau_file"
}

# Compile a circuit
compile_circuit() {
    local circuit_path=$1
    local circuit_name=$(basename "$circuit_path" .circom)
    local output_dir="$BUILD_DIR/$circuit_name"
    
    log_info "Compiling circuit: $circuit_name"
    
    mkdir -p "$output_dir"
    
    # Compile with circom
    circom "$circuit_path" \
        --r1cs \
        --wasm \
        --sym \
        --c \
        -o "$output_dir" \
        -l "$CIRCUITS_DIR"
    
    log_info "Circuit $circuit_name compiled successfully"
    log_info "  R1CS: $output_dir/${circuit_name}.r1cs"
    log_info "  WASM: $output_dir/${circuit_name}_js/${circuit_name}.wasm"
    
    # Get constraint count
    local constraints=$(snarkjs r1cs info "$output_dir/${circuit_name}.r1cs" 2>&1 | grep "Constraints" | awk '{print $2}')
    log_info "  Constraints: $constraints"
    
    echo "$output_dir"
}

# Generate proving and verification keys
generate_keys() {
    local circuit_name=$1
    local output_dir="$BUILD_DIR/$circuit_name"
    local r1cs_file="$output_dir/${circuit_name}.r1cs"
    
    log_info "Generating keys for: $circuit_name"
    
    # Determine required PTAU size based on constraints
    local constraints=$(snarkjs r1cs info "$r1cs_file" 2>&1 | grep "Constraints" | awk '{print $2}')
    local power=12  # Start with 2^12 = 4096
    
    while [ $((2**power)) -lt $constraints ]; do
        power=$((power + 1))
    done
    power=$((power + 1))  # Add margin
    
    log_info "Using Powers of Tau with 2^$power"
    
    local ptau_file=$(download_ptau $power)
    
    # Phase 2: Circuit-specific setup
    log_info "Running Groth16 setup..."
    snarkjs groth16 setup "$r1cs_file" "$ptau_file" "$output_dir/${circuit_name}_0000.zkey"
    
    # Contribute to ceremony (for production, use MPC)
    log_info "Contributing to ceremony..."
    snarkjs zkey contribute "$output_dir/${circuit_name}_0000.zkey" \
        "$output_dir/${circuit_name}_final.zkey" \
        --name="Guthwine V2 Contribution" \
        -e="$(head -c 32 /dev/urandom | xxd -p)"
    
    # Export verification key
    log_info "Exporting verification key..."
    snarkjs zkey export verificationkey "$output_dir/${circuit_name}_final.zkey" \
        "$output_dir/verification_key.json"
    
    # Export Solidity verifier
    log_info "Generating Solidity verifier..."
    snarkjs zkey export solidityverifier "$output_dir/${circuit_name}_final.zkey" \
        "$output_dir/Verifier.sol"
    
    log_info "Keys generated successfully for $circuit_name"
}

# Generate a proof
generate_proof() {
    local circuit_name=$1
    local input_file=$2
    local output_dir="$BUILD_DIR/$circuit_name"
    
    log_info "Generating proof for: $circuit_name"
    
    # Generate witness
    log_info "Computing witness..."
    node "$output_dir/${circuit_name}_js/generate_witness.js" \
        "$output_dir/${circuit_name}_js/${circuit_name}.wasm" \
        "$input_file" \
        "$output_dir/witness.wtns"
    
    # Generate proof
    log_info "Generating Groth16 proof..."
    snarkjs groth16 prove "$output_dir/${circuit_name}_final.zkey" \
        "$output_dir/witness.wtns" \
        "$output_dir/proof.json" \
        "$output_dir/public.json"
    
    log_info "Proof generated successfully"
    log_info "  Proof: $output_dir/proof.json"
    log_info "  Public inputs: $output_dir/public.json"
}

# Verify a proof
verify_proof() {
    local circuit_name=$1
    local output_dir="$BUILD_DIR/$circuit_name"
    
    log_info "Verifying proof for: $circuit_name"
    
    snarkjs groth16 verify \
        "$output_dir/verification_key.json" \
        "$output_dir/public.json" \
        "$output_dir/proof.json"
    
    log_info "Proof verified successfully!"
}

# Main execution
main() {
    local command=${1:-"help"}
    
    case $command in
        compile)
            if [ -z "$2" ]; then
                log_error "Usage: $0 compile <circuit.circom>"
                exit 1
            fi
            compile_circuit "$2"
            ;;
        
        setup)
            if [ -z "$2" ]; then
                log_error "Usage: $0 setup <circuit_name>"
                exit 1
            fi
            generate_keys "$2"
            ;;
        
        prove)
            if [ -z "$2" ] || [ -z "$3" ]; then
                log_error "Usage: $0 prove <circuit_name> <input.json>"
                exit 1
            fi
            generate_proof "$2" "$3"
            ;;
        
        verify)
            if [ -z "$2" ]; then
                log_error "Usage: $0 verify <circuit_name>"
                exit 1
            fi
            verify_proof "$2"
            ;;
        
        all)
            if [ -z "$2" ] || [ -z "$3" ]; then
                log_error "Usage: $0 all <circuit.circom> <input.json>"
                exit 1
            fi
            local circuit_path=$2
            local input_file=$3
            local circuit_name=$(basename "$circuit_path" .circom)
            
            compile_circuit "$circuit_path"
            generate_keys "$circuit_name"
            generate_proof "$circuit_name" "$input_file"
            verify_proof "$circuit_name"
            ;;
        
        help|*)
            echo "Guthwine V2 Circuit Compilation Script"
            echo ""
            echo "Usage: $0 <command> [arguments]"
            echo ""
            echo "Commands:"
            echo "  compile <circuit.circom>              Compile a Circom circuit"
            echo "  setup <circuit_name>                  Generate proving/verification keys"
            echo "  prove <circuit_name> <input.json>     Generate a proof"
            echo "  verify <circuit_name>                 Verify the generated proof"
            echo "  all <circuit.circom> <input.json>     Run full pipeline"
            echo "  help                                  Show this help message"
            ;;
    esac
}

main "$@"
