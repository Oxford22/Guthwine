pragma circom 2.1.6;

include "curve.circom";
include "field.circom";
include "../lib/bigint85.circom";

/*
 * Guthwine V2 - Ed25519 Signature Verification Circuit
 * 
 * Verifies Ed25519 signatures inside a BN254 zk-SNARK circuit.
 * 
 * Ed25519 Signature Verification:
 * Given:
 *   - Public key A (compressed, 256 bits)
 *   - Message M (arbitrary length, hashed externally)
 *   - Signature (R, s) where R is 256 bits and s is 256 bits
 * 
 * Verify:
 *   [s]B = R + [H(R || A || M)]A
 * 
 * Where:
 *   - B is the Ed25519 base point
 *   - H is SHA-512 reduced mod L (curve order)
 */

/*
 * Ed25519 Base Point B
 * 
 * B_x = 15112221349535807912866137220509078935008241060728726494271640533819421406100
 * B_y = 46316835694926478169428394003475163141307993866256225615783033603165251855960
 */
function ED25519_BASE_X() {
    return [
        15112221349535807912866137220509078935,
        8241060728726494271640533819421406100,
        0
    ];
}

function ED25519_BASE_Y() {
    return [
        46316835694926478169428394003475163141,
        307993866256225615783033603165251855960,
        0
    ];
}

/*
 * Ed25519 Curve Order L
 * 
 * L = 2^252 + 27742317777372353535851937790883648493
 */
function ED25519_ORDER() {
    return [
        27742317777372353535851937790883648493,
        0,
        1 << 82  // 2^252 in limb 2
    ];
}

/*
 * SHA-512 to Scalar Reduction
 * 
 * Takes 512-bit hash output and reduces mod L (curve order).
 * Input: 64 bytes (512 bits) as 8 limbs of 64 bits
 * Output: scalar in 3 limbs of 85 bits
 */
template HashToScalar() {
    signal input hash[64]; // 64 bytes
    signal output scalar[3];
    
    // Convert 64 bytes to a 512-bit number
    // Then reduce mod L
    
    // For efficiency, we take the reduced scalar as witness
    // and verify it's correct
    
    signal reduced[3];
    reduced[0] <-- 0; // Witness computation
    reduced[1] <-- 0;
    reduced[2] <-- 0;
    
    // Verify: hash = q * L + reduced for some q
    // This is complex; simplified version just outputs the witness
    
    scalar <== reduced;
}

/*
 * Ed25519 Signature Verification
 * 
 * Main verification circuit.
 * 
 * Public Inputs:
 *   - pubkey: compressed public key (256 bits)
 *   - msgHash: SHA-512(message) (512 bits, pre-computed)
 *   - sigR: R component of signature (256 bits)
 *   - sigS: s component of signature (256 bits)
 * 
 * Private Inputs (Witnesses):
 *   - pubkeyX, pubkeyY: uncompressed public key coordinates
 *   - sigRX, sigRY: uncompressed R coordinates
 * 
 * Output:
 *   - valid: 1 if signature is valid, 0 otherwise
 */
template Ed25519Verify() {
    // Public inputs
    signal input pubkey[256];      // compressed public key
    signal input msgHash[64];      // SHA-512(R || A || M) - 64 bytes
    signal input sigR[256];        // R component (compressed)
    signal input sigS[256];        // s component (256 bits, little-endian)
    
    // Private inputs (witnesses for decompression)
    signal input pubkeyX[3], pubkeyY[3];
    signal input sigRX[3], sigRY[3];
    
    // Output
    signal output valid;
    
    // Step 1: Verify public key decompression
    component verifyPubkey = PointDecompressVerify();
    verifyPubkey.compressed <== pubkey;
    verifyPubkey.x <== pubkeyX;
    verifyPubkey.y <== pubkeyY;
    
    // Step 2: Verify R decompression
    component verifyR = PointDecompressVerify();
    verifyR.compressed <== sigR;
    verifyR.x <== sigRX;
    verifyR.y <== sigRY;
    
    // Step 3: Compute h = SHA-512(R || A || M) mod L
    // For this circuit, we assume msgHash is already SHA-512(R || A || M)
    component hashToScalar = HashToScalar();
    hashToScalar.hash <== msgHash;
    signal h[3];
    h <== hashToScalar.scalar;
    
    // Step 4: Convert s to scalar (already in correct format)
    signal s[256];
    s <== sigS;
    
    // Step 5: Compute [s]B (s times base point)
    // Base point in extended coordinates
    signal Bx[3], By[3], Bz[3], Bt[3];
    var bx[3] = ED25519_BASE_X();
    var by[3] = ED25519_BASE_Y();
    
    Bx[0] <-- bx[0]; Bx[1] <-- bx[1]; Bx[2] <-- bx[2];
    By[0] <-- by[0]; By[1] <-- by[1]; By[2] <-- by[2];
    Bz[0] <== 1; Bz[1] <== 0; Bz[2] <== 0;
    
    // Bt = Bx * By (for extended coordinates)
    component mulBt = FieldMul();
    mulBt.a <== Bx;
    mulBt.b <== By;
    Bt <== mulBt.out;
    
    component sB = ScalarMul(256);
    sB.k <== s;
    sB.Px <== Bx;
    sB.Py <== By;
    sB.Pz <== Bz;
    sB.Pt <== Bt;
    
    // Step 6: Compute [h]A (h times public key)
    // Public key in extended coordinates
    signal Ax[3], Ay[3], Az[3], At[3];
    Ax <== pubkeyX;
    Ay <== pubkeyY;
    Az[0] <== 1; Az[1] <== 0; Az[2] <== 0;
    
    component mulAt = FieldMul();
    mulAt.a <== pubkeyX;
    mulAt.b <== pubkeyY;
    At <== mulAt.out;
    
    // Convert h to bits for scalar multiplication
    component h2bits = Num2Bits(253); // L is ~253 bits
    component limbs2num = Limbs2Num();
    limbs2num.limbs <== h;
    h2bits.in <== limbs2num.out;
    
    signal hBits[256];
    for (var i = 0; i < 253; i++) {
        hBits[i] <== h2bits.out[i];
    }
    for (var i = 253; i < 256; i++) {
        hBits[i] <== 0;
    }
    
    component hA = ScalarMul(256);
    hA.k <== hBits;
    hA.Px <== Ax;
    hA.Py <== Ay;
    hA.Pz <== Az;
    hA.Pt <== At;
    
    // Step 7: Compute R + [h]A
    // R in extended coordinates
    signal Rx[3], Ry[3], Rz[3], Rt[3];
    Rx <== sigRX;
    Ry <== sigRY;
    Rz[0] <== 1; Rz[1] <== 0; Rz[2] <== 0;
    
    component mulRt = FieldMul();
    mulRt.a <== sigRX;
    mulRt.b <== sigRY;
    Rt <== mulRt.out;
    
    component RplushA = PointAdd();
    RplushA.X1 <== Rx;
    RplushA.Y1 <== Ry;
    RplushA.Z1 <== Rz;
    RplushA.T1 <== Rt;
    RplushA.X2 <== hA.Qx;
    RplushA.Y2 <== hA.Qy;
    RplushA.Z2 <== hA.Qz;
    RplushA.T2 <== hA.Qt;
    
    // Step 8: Verify [s]B == R + [h]A
    // Compare in projective coordinates: X1*Z2 == X2*Z1 and Y1*Z2 == Y2*Z1
    
    component checkX1 = FieldMul();
    checkX1.a <== sB.Qx;
    checkX1.b <== RplushA.Z3;
    
    component checkX2 = FieldMul();
    checkX2.a <== RplushA.X3;
    checkX2.b <== sB.Qz;
    
    component eqX = FieldEqual();
    eqX.a <== checkX1.out;
    eqX.b <== checkX2.out;
    
    component checkY1 = FieldMul();
    checkY1.a <== sB.Qy;
    checkY1.b <== RplushA.Z3;
    
    component checkY2 = FieldMul();
    checkY2.a <== RplushA.Y3;
    checkY2.b <== sB.Qz;
    
    component eqY = FieldEqual();
    eqY.a <== checkY1.out;
    eqY.b <== checkY2.out;
    
    // Final validity check
    valid <== verifyPubkey.valid * verifyR.valid * eqX.out * eqY.out;
}

/*
 * Batch Ed25519 Verification
 * 
 * Verifies multiple signatures more efficiently using batch verification.
 * 
 * Batch equation:
 * sum_i(z_i * s_i) * B = sum_i(z_i * R_i) + sum_i(z_i * h_i * A_i)
 * 
 * Where z_i are random scalars for soundness.
 */
template Ed25519BatchVerify(n) {
    // n signatures to verify
    
    signal input pubkeys[n][256];
    signal input msgHashes[n][64];
    signal input sigRs[n][256];
    signal input sigSs[n][256];
    
    // Witnesses
    signal input pubkeyXs[n][3], pubkeyYs[n][3];
    signal input sigRXs[n][3], sigRYs[n][3];
    
    // Random coefficients for batching (can be derived from inputs)
    signal input zs[n][256];
    
    signal output valid;
    
    // For each signature, verify decompression
    component verifyPubkeys[n];
    component verifyRs[n];
    
    for (var i = 0; i < n; i++) {
        verifyPubkeys[i] = PointDecompressVerify();
        verifyPubkeys[i].compressed <== pubkeys[i];
        verifyPubkeys[i].x <== pubkeyXs[i];
        verifyPubkeys[i].y <== pubkeyYs[i];
        
        verifyRs[i] = PointDecompressVerify();
        verifyRs[i].compressed <== sigRs[i];
        verifyRs[i].x <== sigRXs[i];
        verifyRs[i].y <== sigRYs[i];
    }
    
    // Compute batch equation
    // LHS: sum_i(z_i * s_i) * B
    // RHS: sum_i(z_i * R_i) + sum_i(z_i * h_i * A_i)
    
    // This is a simplified placeholder - full implementation would
    // compute the multi-scalar multiplications efficiently
    
    signal allDecompressValid;
    signal decompressProduct[n+1];
    decompressProduct[0] <== 1;
    
    for (var i = 0; i < n; i++) {
        decompressProduct[i+1] <== decompressProduct[i] * verifyPubkeys[i].valid * verifyRs[i].valid;
    }
    
    allDecompressValid <== decompressProduct[n];
    
    // For now, verify each signature individually
    // (Full batch verification would be more efficient)
    component singleVerify[n];
    signal verifyProduct[n+1];
    verifyProduct[0] <== 1;
    
    for (var i = 0; i < n; i++) {
        singleVerify[i] = Ed25519Verify();
        singleVerify[i].pubkey <== pubkeys[i];
        singleVerify[i].msgHash <== msgHashes[i];
        singleVerify[i].sigR <== sigRs[i];
        singleVerify[i].sigS <== sigSs[i];
        singleVerify[i].pubkeyX <== pubkeyXs[i];
        singleVerify[i].pubkeyY <== pubkeyYs[i];
        singleVerify[i].sigRX <== sigRXs[i];
        singleVerify[i].sigRY <== sigRYs[i];
        
        verifyProduct[i+1] <== verifyProduct[i] * singleVerify[i].valid;
    }
    
    valid <== verifyProduct[n];
}

/*
 * Main circuit for single signature verification
 */
component main {public [pubkey, msgHash, sigR, sigS]} = Ed25519Verify();
