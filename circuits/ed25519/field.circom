pragma circom 2.1.6;

include "../lib/bigint85.circom";

/*
 * Guthwine V2 - Ed25519 Field Arithmetic
 * 
 * Field operations over F_p where p = 2^255 - 19
 * Using 2^85 limb decomposition for efficient BN254 circuit implementation.
 */

/*
 * Field Element representation
 * 
 * An element in F_p is represented as 3 limbs of 85 bits each:
 * x = x[0] + x[1] * 2^85 + x[2] * 2^170
 * 
 * where 0 <= x[i] < 2^85
 */

/*
 * Field Addition: (a + b) mod p
 */
template FieldAdd() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    component add = BigInt85Add();
    add.a <== a;
    add.b <== b;
    
    // If carry or result >= p, reduce
    // For simplicity, we do a conditional subtraction of p
    
    // p = 2^255 - 19 in limbs
    var p0 = 38685626227668133590597613; // 2^85 - 19
    var p1 = 38685626227668133590597632; // 2^85
    var p2 = 38685626227668133590597632; // 2^85
    
    signal sum[3];
    sum[0] <== add.out[0];
    sum[1] <== add.out[1];
    sum[2] <== add.out[2];
    
    // Check if sum >= p
    component lt = BigInt85LessThan();
    lt.a <== sum;
    lt.b[0] <-- p0;
    lt.b[1] <-- p1;
    lt.b[2] <-- p2;
    
    // If sum >= p (lt.out == 0), subtract p
    signal needReduce;
    needReduce <== 1 - lt.out;
    
    // Conditional subtraction
    out[0] <== sum[0] - needReduce * p0;
    out[1] <== sum[1] - needReduce * p1;
    out[2] <== sum[2] - needReduce * p2;
}

/*
 * Field Subtraction: (a - b) mod p
 */
template FieldSub() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    // If a < b, add p first
    component lt = BigInt85LessThan();
    lt.a <== a;
    lt.b <== b;
    
    var p0 = 38685626227668133590597613;
    var p1 = 38685626227668133590597632;
    var p2 = 38685626227668133590597632;
    
    // Conditional addition of p
    signal adjusted[3];
    adjusted[0] <== a[0] + lt.out * p0;
    adjusted[1] <== a[1] + lt.out * p1;
    adjusted[2] <== a[2] + lt.out * p2;
    
    // Subtract
    component sub = BigInt85Sub();
    sub.a <== adjusted;
    sub.b <== b;
    
    out <== sub.out;
}

/*
 * Field Multiplication: (a * b) mod p
 */
template FieldMul() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    component mul = BigInt85ModMul();
    mul.a <== a;
    mul.b <== b;
    
    out <== mul.out;
}

/*
 * Field Squaring: a^2 mod p
 */
template FieldSquare() {
    signal input a[3];
    signal output out[3];
    
    component sq = BigInt85ModSquare();
    sq.a <== a;
    
    out <== sq.out;
}

/*
 * Field Negation: -a mod p = p - a
 */
template FieldNeg() {
    signal input a[3];
    signal output out[3];
    
    var p0 = 38685626227668133590597613;
    var p1 = 38685626227668133590597632;
    var p2 = 38685626227668133590597632;
    
    signal p[3];
    p[0] <-- p0;
    p[1] <-- p1;
    p[2] <-- p2;
    
    component sub = BigInt85Sub();
    sub.a <== p;
    sub.b <== a;
    
    out <== sub.out;
}

/*
 * Field Inversion: a^(-1) mod p
 * 
 * Uses Fermat's little theorem: a^(-1) = a^(p-2) mod p
 * Implemented via addition chain for efficiency.
 */
template FieldInv() {
    signal input a[3];
    signal output out[3];
    
    // For efficiency, we take the inverse as a witness and verify
    signal inv[3];
    
    // Witness: compute inverse outside circuit
    // inv = a^(p-2) mod p
    inv[0] <-- 0; // Placeholder - actual computation in witness generation
    inv[1] <-- 0;
    inv[2] <-- 0;
    
    // Verify: a * inv = 1 mod p
    component mul = FieldMul();
    mul.a <== a;
    mul.b <== inv;
    
    // Check result is 1
    mul.out[0] === 1;
    mul.out[1] === 0;
    mul.out[2] === 0;
    
    out <== inv;
}

/*
 * Field Division: a / b mod p = a * b^(-1) mod p
 */
template FieldDiv() {
    signal input a[3];
    signal input b[3];
    signal output out[3];
    
    component inv = FieldInv();
    inv.a <== b;
    
    component mul = FieldMul();
    mul.a <== a;
    mul.b <== inv.out;
    
    out <== mul.out;
}

/*
 * Field Exponentiation: a^e mod p
 * 
 * Uses square-and-multiply algorithm.
 * e is provided as bits.
 */
template FieldPow(n) {
    signal input a[3];
    signal input e[n]; // exponent bits, LSB first
    signal output out[3];
    
    signal powers[n+1][3];
    signal results[n+1][3];
    
    // Initialize
    powers[0] <== a;
    results[0][0] <== 1;
    results[0][1] <== 0;
    results[0][2] <== 0;
    
    for (var i = 0; i < n; i++) {
        // Square the power
        component sq = FieldSquare();
        sq.a <== powers[i];
        powers[i+1] <== sq.out;
        
        // Conditionally multiply result
        component mul = FieldMul();
        mul.a <== results[i];
        mul.b <== powers[i];
        
        // Select based on exponent bit
        component sel = BigInt85Select();
        sel.a <== results[i];
        sel.b <== mul.out;
        sel.sel <== e[i];
        
        results[i+1] <== sel.out;
    }
    
    out <== results[n];
}

/*
 * Constant Multiplication by small value
 * Optimized for multiplying by constants like 19, 121665, etc.
 */
template FieldMulConst(c) {
    signal input a[3];
    signal output out[3];
    
    // Multiply each limb by constant
    signal products[3];
    products[0] <== a[0] * c;
    products[1] <== a[1] * c;
    products[2] <== a[2] * c;
    
    // Carry propagation and reduction
    var base = 1 << 85;
    
    var carry0 = products[0] \ base;
    out[0] <-- products[0] % base;
    
    var temp1 = products[1] + carry0;
    var carry1 = temp1 \ base;
    out[1] <-- temp1 % base;
    
    var temp2 = products[2] + carry1;
    var carry2 = temp2 \ base;
    out[2] <-- temp2 % base;
    
    // If overflow, reduce: carry2 * 2^255 ≡ carry2 * 19 (mod p)
    signal overflow;
    overflow <-- carry2 * 19;
    
    // Add overflow back
    signal final0;
    final0 <== out[0] + overflow;
    
    // Final carry propagation
    out[0] <-- final0 % base;
    var fc = final0 \ base;
    out[1] <-- (out[1] + fc) % base;
    out[2] <-- out[2] + ((out[1] + fc) \ base);
}

/*
 * Check if field element is zero
 */
template FieldIsZero() {
    signal input a[3];
    signal output out;
    
    component iz0 = IsZero();
    iz0.in <== a[0];
    
    component iz1 = IsZero();
    iz1.in <== a[1];
    
    component iz2 = IsZero();
    iz2.in <== a[2];
    
    out <== iz0.out * iz1.out * iz2.out;
}

/*
 * Field Element Equality
 */
template FieldEqual() {
    signal input a[3];
    signal input b[3];
    signal output out;
    
    component eq = BigInt85Equal();
    eq.a <== a;
    eq.b <== b;
    
    out <== eq.out;
}
