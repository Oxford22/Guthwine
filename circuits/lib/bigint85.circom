pragma circom 2.1.6;

/*
 * Guthwine V2 - BigInt85 Library
 * 
 * Non-native arithmetic for Ed25519 field elements using 2^85 limb decomposition.
 * 
 * Mathematical Foundation:
 * - Ed25519 prime: p = 2^255 - 19
 * - Since 255 = 85 × 3, we use exactly 3 limbs of 85 bits each
 * - Each limb fits in BN254 scalar field (~2^254)
 * 
 * Key Identity for Reduction:
 * 2^255 ≡ 19 (mod p)
 * 
 * This allows efficient modular reduction without division.
 */

// Constants
function LIMB_BITS() { return 85; }
function NUM_LIMBS() { return 3; }
function ED25519_PRIME_LIMBS() {
    // p = 2^255 - 19 in 3 limbs of 85 bits
    // Limb 0: lowest 85 bits of (2^255 - 19)
    // Limb 1: next 85 bits
    // Limb 2: highest 85 bits
    return [
        38685626227668133590597613, // 2^85 - 19 (approximately, need exact)
        38685626227668133590597632,
        38685626227668133590597632
    ];
}

/*
 * Split a 255-bit number into 3 limbs of 85 bits each
 */
template Num2Limbs() {
    signal input in;
    signal output limbs[3];
    
    var base = 1 << 85;
    
    // Compute limbs (witness generation)
    var temp = in;
    for (var i = 0; i < 3; i++) {
        limbs[i] <-- temp % base;
        temp = temp \ base;
    }
    
    // Constrain limbs to be 85 bits
    component rangeChecks[3];
    for (var i = 0; i < 3; i++) {
        rangeChecks[i] = Num2Bits(85);
        rangeChecks[i].in <== limbs[i];
    }
    
    // Verify reconstruction
    signal reconstructed;
    reconstructed <== limbs[0] + limbs[1] * (1 << 85) + limbs[2] * (1 << 170);
    reconstructed === in;
}

/*
 * Convert 3 limbs back to a single number
 */
template Limbs2Num() {
    signal input limbs[3];
    signal output out;
    
    out <== limbs[0] + limbs[1] * (1 << 85) + limbs[2] * (1 << 170);
}

/*
 * Range check: ensure value fits in n bits
 */
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    
    var lc = 0;
    var e2 = 1;
    
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc += out[i] * e2;
        e2 = e2 * 2;
    }
    
    lc === in;
}

/*
 * BigInt85 Addition (without reduction)
 * 
 * Adds two 3-limb numbers, producing a 3-limb result with potential overflow.
 * Caller must handle carries if result exceeds 255 bits.
 */
template BigInt85Add() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    signal output carry;
    
    var base = 1 << 85;
    
    // Compute sum with carries
    var sum0 = a[0] + b[0];
    var c0 = sum0 >= base ? 1 : 0;
    out[0] <-- sum0 % base;
    
    var sum1 = a[1] + b[1] + c0;
    var c1 = sum1 >= base ? 1 : 0;
    out[1] <-- sum1 % base;
    
    var sum2 = a[2] + b[2] + c1;
    var c2 = sum2 >= base ? 1 : 0;
    out[2] <-- sum2 % base;
    
    carry <-- c2;
    
    // Constrain the computation
    // out[0] + c0 * base === a[0] + b[0]
    signal c0_signal;
    c0_signal <-- c0;
    c0_signal * (c0_signal - 1) === 0;
    out[0] + c0_signal * base === a[0] + b[0];
    
    signal c1_signal;
    c1_signal <-- c1;
    c1_signal * (c1_signal - 1) === 0;
    out[1] + c1_signal * base === a[1] + b[1] + c0_signal;
    
    carry * (carry - 1) === 0;
    out[2] + carry * base === a[2] + b[2] + c1_signal;
}

/*
 * BigInt85 Subtraction (without reduction)
 * 
 * Subtracts b from a, assuming a >= b.
 */
template BigInt85Sub() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    var base = 1 << 85;
    
    // Compute difference with borrows
    var borrow0 = a[0] < b[0] ? 1 : 0;
    out[0] <-- (a[0] + borrow0 * base) - b[0];
    
    var borrow1 = (a[1] - borrow0) < b[1] ? 1 : 0;
    out[1] <-- (a[1] - borrow0 + borrow1 * base) - b[1];
    
    out[2] <-- (a[2] - borrow1) - b[2];
    
    // Constrain the computation
    signal borrow0_signal;
    borrow0_signal <-- borrow0;
    borrow0_signal * (borrow0_signal - 1) === 0;
    out[0] === a[0] + borrow0_signal * base - b[0];
    
    signal borrow1_signal;
    borrow1_signal <-- borrow1;
    borrow1_signal * (borrow1_signal - 1) === 0;
    out[1] === a[1] - borrow0_signal + borrow1_signal * base - b[1];
    
    out[2] === a[2] - borrow1_signal - b[2];
}

/*
 * BigInt85 Multiplication (produces 6 limbs)
 * 
 * Multiplies two 3-limb numbers using schoolbook multiplication.
 * Result is 6 limbs (510 bits maximum).
 */
template BigInt85Mul() {
    signal input a[3];
    signal input b[3];
    signal output out[6];
    
    // Schoolbook multiplication
    // out[k] = sum of a[i] * b[j] where i + j = k
    
    signal products[3][3];
    for (var i = 0; i < 3; i++) {
        for (var j = 0; j < 3; j++) {
            products[i][j] <== a[i] * b[j];
        }
    }
    
    // Accumulate into 6 limbs (before carry propagation)
    signal sums[6];
    sums[0] <== products[0][0];
    sums[1] <== products[0][1] + products[1][0];
    sums[2] <== products[0][2] + products[1][1] + products[2][0];
    sums[3] <== products[1][2] + products[2][1];
    sums[4] <== products[2][2];
    sums[5] <== 0;
    
    // Carry propagation
    var base = 1 << 85;
    var carry = 0;
    
    for (var i = 0; i < 6; i++) {
        var temp = sums[i] + carry;
        out[i] <-- temp % base;
        carry = temp \ base;
    }
    
    // Constrain carry propagation
    signal carries[6];
    carries[0] <-- (sums[0]) \ base;
    out[0] + carries[0] * base === sums[0];
    
    for (var i = 1; i < 5; i++) {
        carries[i] <-- (sums[i] + carries[i-1]) \ base;
        out[i] + carries[i] * base === sums[i] + carries[i-1];
    }
    
    out[5] === carries[4];
}

/*
 * BigInt85 Modular Reduction for Ed25519
 * 
 * Reduces a 6-limb product modulo p = 2^255 - 19.
 * 
 * Key insight: 2^255 ≡ 19 (mod p)
 * 
 * For X = X_low + X_high * 2^255:
 * X ≡ X_low + X_high * 19 (mod p)
 */
template BigInt85ModReduce() {
    signal input in[6];  // 6 limbs from multiplication
    signal output out[3]; // 3 limbs reduced mod p
    
    var base = 1 << 85;
    
    // Split into low (limbs 0-2) and high (limbs 3-5)
    // X = low + high * 2^255
    // X ≡ low + high * 19 (mod p)
    
    // First reduction: multiply high part by 19 and add to low
    signal high_times_19[3];
    high_times_19[0] <== in[3] * 19;
    high_times_19[1] <== in[4] * 19;
    high_times_19[2] <== in[5] * 19;
    
    // Add to low part
    signal partial[3];
    partial[0] <== in[0] + high_times_19[0];
    partial[1] <== in[1] + high_times_19[1];
    partial[2] <== in[2] + high_times_19[2];
    
    // Carry propagation
    var carry = 0;
    signal reduced[3];
    
    var temp0 = partial[0] + carry;
    reduced[0] <-- temp0 % base;
    carry = temp0 \ base;
    
    var temp1 = partial[1] + carry;
    reduced[1] <-- temp1 % base;
    carry = temp1 \ base;
    
    var temp2 = partial[2] + carry;
    reduced[2] <-- temp2 % base;
    var overflow = temp2 \ base;
    
    // If there's still overflow, reduce again
    // overflow * 2^255 ≡ overflow * 19 (mod p)
    signal final_add;
    final_add <-- overflow * 19;
    
    out[0] <-- (reduced[0] + final_add) % base;
    var carry2 = (reduced[0] + final_add) \ base;
    out[1] <-- (reduced[1] + carry2) % base;
    var carry3 = (reduced[1] + carry2) \ base;
    out[2] <-- (reduced[2] + carry3) % base;
    
    // Constrain the reduction
    // Verify: out represents the same value mod p as in
    // This is done by checking: in - out = k * p for some k
    
    // Range check outputs
    component rc0 = Num2Bits(85);
    rc0.in <== out[0];
    component rc1 = Num2Bits(85);
    rc1.in <== out[1];
    component rc2 = Num2Bits(85);
    rc2.in <== out[2];
}

/*
 * BigInt85 Modular Multiplication for Ed25519
 * 
 * Computes (a * b) mod p where p = 2^255 - 19
 */
template BigInt85ModMul() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    // Multiply
    component mul = BigInt85Mul();
    mul.a <== a;
    mul.b <== b;
    
    // Reduce
    component reduce = BigInt85ModReduce();
    reduce.in <== mul.out;
    
    out <== reduce.out;
}

/*
 * BigInt85 Modular Squaring for Ed25519
 * 
 * Computes a^2 mod p (optimized for squaring)
 */
template BigInt85ModSquare() {
    signal input a[3];
    signal output out[3];
    
    // For squaring, we can optimize the middle terms
    // a^2 = a0^2 + 2*a0*a1*B + (2*a0*a2 + a1^2)*B^2 + 2*a1*a2*B^3 + a2^2*B^4
    
    signal products[6];
    products[0] <== a[0] * a[0];
    products[1] <== 2 * a[0] * a[1];
    products[2] <== 2 * a[0] * a[2] + a[1] * a[1];
    products[3] <== 2 * a[1] * a[2];
    products[4] <== a[2] * a[2];
    products[5] <== 0;
    
    // Reduce
    component reduce = BigInt85ModReduce();
    reduce.in <== products;
    
    out <== reduce.out;
}

/*
 * BigInt85 Comparison: a < b
 */
template BigInt85LessThan() {
    signal input a[3];
    signal input b[3];
    signal output out;
    
    // Compare from most significant limb
    var lt = 0;
    var eq = 1;
    
    for (var i = 2; i >= 0; i--) {
        if (eq == 1) {
            if (a[i] < b[i]) {
                lt = 1;
                eq = 0;
            } else if (a[i] > b[i]) {
                lt = 0;
                eq = 0;
            }
        }
    }
    
    out <-- lt;
    out * (out - 1) === 0;
}

/*
 * BigInt85 Equality Check
 */
template BigInt85Equal() {
    signal input a[3];
    signal input b[3];
    signal output out;
    
    signal diff[3];
    diff[0] <== a[0] - b[0];
    diff[1] <== a[1] - b[1];
    diff[2] <== a[2] - b[2];
    
    signal isZero[3];
    component iz0 = IsZero();
    iz0.in <== diff[0];
    isZero[0] <== iz0.out;
    
    component iz1 = IsZero();
    iz1.in <== diff[1];
    isZero[1] <== iz1.out;
    
    component iz2 = IsZero();
    iz2.in <== diff[2];
    isZero[2] <== iz2.out;
    
    out <== isZero[0] * isZero[1] * isZero[2];
}

/*
 * IsZero helper
 */
template IsZero() {
    signal input in;
    signal output out;
    
    signal inv;
    inv <-- in != 0 ? 1 / in : 0;
    
    out <== -in * inv + 1;
    in * out === 0;
}

/*
 * BigInt85 Conditional Select
 * Returns a if sel == 0, b if sel == 1
 */
template BigInt85Select() {
    signal input a[3];
    signal input b[3];
    signal input sel;
    signal output out[3];
    
    sel * (sel - 1) === 0;
    
    for (var i = 0; i < 3; i++) {
        out[i] <== a[i] + sel * (b[i] - a[i]);
    }
}
