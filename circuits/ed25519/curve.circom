pragma circom 2.1.6;

include "field.circom";

/*
 * Guthwine V2 - Ed25519 Curve Operations
 * 
 * Ed25519 is a Twisted Edwards curve defined by:
 * -x^2 + y^2 = 1 + d*x^2*y^2
 * 
 * where d = -121665/121666 (mod p)
 * 
 * The curve has order 8 * L where L is a large prime.
 * The base point B has order L.
 */

/*
 * Ed25519 curve constant d = -121665/121666 mod p
 * 
 * d = 37095705934669439343138083508754565189542113879843219016388785533085940283555
 * 
 * In 3 limbs of 85 bits:
 */
function ED25519_D() {
    return [
        20800338683988658368,     // Limb 0
        8269519077653016525,      // Limb 1
        2957795584594298680       // Limb 2
    ];
}

/*
 * 2*d for doubling formula
 */
function ED25519_2D() {
    return [
        41600677367977316736,
        16539038155306033050,
        5915591169188597360
    ];
}

/*
 * Point on Ed25519 curve in Extended Coordinates
 * 
 * Extended coordinates (X, Y, Z, T) where:
 * x = X/Z, y = Y/Z, x*y = T/Z
 * 
 * This representation allows for faster addition without division.
 */

/*
 * Point Addition in Extended Coordinates
 * 
 * Uses the unified addition formula for Twisted Edwards curves.
 * 
 * Input: P1 = (X1, Y1, Z1, T1), P2 = (X2, Y2, Z2, T2)
 * Output: P3 = P1 + P2 = (X3, Y3, Z3, T3)
 */
template PointAdd() {
    signal input X1[3], Y1[3], Z1[3], T1[3];
    signal input X2[3], Y2[3], Z2[3], T2[3];
    signal output X3[3], Y3[3], Z3[3], T3[3];
    
    // A = X1 * X2
    component mulA = FieldMul();
    mulA.a <== X1;
    mulA.b <== X2;
    signal A[3];
    A <== mulA.out;
    
    // B = Y1 * Y2
    component mulB = FieldMul();
    mulB.a <== Y1;
    mulB.b <== Y2;
    signal B[3];
    B <== mulB.out;
    
    // C = T1 * d * T2
    component mulT = FieldMul();
    mulT.a <== T1;
    mulT.b <== T2;
    signal T1T2[3];
    T1T2 <== mulT.out;
    
    // Multiply by d
    signal d[3];
    var dLimbs[3] = ED25519_D();
    d[0] <-- dLimbs[0];
    d[1] <-- dLimbs[1];
    d[2] <-- dLimbs[2];
    
    component mulD = FieldMul();
    mulD.a <== T1T2;
    mulD.b <== d;
    signal C[3];
    C <== mulD.out;
    
    // D = Z1 * Z2
    component mulZ = FieldMul();
    mulZ.a <== Z1;
    mulZ.b <== Z2;
    signal D[3];
    D <== mulZ.out;
    
    // E = (X1 + Y1) * (X2 + Y2) - A - B
    component addXY1 = FieldAdd();
    addXY1.a <== X1;
    addXY1.b <== Y1;
    
    component addXY2 = FieldAdd();
    addXY2.a <== X2;
    addXY2.b <== Y2;
    
    component mulE = FieldMul();
    mulE.a <== addXY1.out;
    mulE.b <== addXY2.out;
    
    component subEA = FieldSub();
    subEA.a <== mulE.out;
    subEA.b <== A;
    
    component subEB = FieldSub();
    subEB.a <== subEA.out;
    subEB.b <== B;
    signal E[3];
    E <== subEB.out;
    
    // F = D - C
    component subF = FieldSub();
    subF.a <== D;
    subF.b <== C;
    signal F[3];
    F <== subF.out;
    
    // G = D + C
    component addG = FieldAdd();
    addG.a <== D;
    addG.b <== C;
    signal G[3];
    G <== addG.out;
    
    // H = B - (-1)*A = B + A (since a = -1 for Ed25519)
    component addH = FieldAdd();
    addH.a <== B;
    addH.b <== A;
    signal H[3];
    H <== addH.out;
    
    // X3 = E * F
    component mulX3 = FieldMul();
    mulX3.a <== E;
    mulX3.b <== F;
    X3 <== mulX3.out;
    
    // Y3 = G * H
    component mulY3 = FieldMul();
    mulY3.a <== G;
    mulY3.b <== H;
    Y3 <== mulY3.out;
    
    // T3 = E * H
    component mulT3 = FieldMul();
    mulT3.a <== E;
    mulT3.b <== H;
    T3 <== mulT3.out;
    
    // Z3 = F * G
    component mulZ3 = FieldMul();
    mulZ3.a <== F;
    mulZ3.b <== G;
    Z3 <== mulZ3.out;
}

/*
 * Point Doubling in Extended Coordinates
 * 
 * Optimized formula for P + P.
 */
template PointDouble() {
    signal input X1[3], Y1[3], Z1[3], T1[3];
    signal output X3[3], Y3[3], Z3[3], T3[3];
    
    // A = X1^2
    component sqA = FieldSquare();
    sqA.a <== X1;
    signal A[3];
    A <== sqA.out;
    
    // B = Y1^2
    component sqB = FieldSquare();
    sqB.a <== Y1;
    signal B[3];
    B <== sqB.out;
    
    // C = 2 * Z1^2
    component sqZ = FieldSquare();
    sqZ.a <== Z1;
    component addC = FieldAdd();
    addC.a <== sqZ.out;
    addC.b <== sqZ.out;
    signal C[3];
    C <== addC.out;
    
    // H = A + B
    component addH = FieldAdd();
    addH.a <== A;
    addH.b <== B;
    signal H[3];
    H <== addH.out;
    
    // E = H - (X1 + Y1)^2
    component addXY = FieldAdd();
    addXY.a <== X1;
    addXY.b <== Y1;
    
    component sqXY = FieldSquare();
    sqXY.a <== addXY.out;
    
    component subE = FieldSub();
    subE.a <== H;
    subE.b <== sqXY.out;
    signal E[3];
    E <== subE.out;
    
    // G = A - B (since a = -1)
    component subG = FieldSub();
    subG.a <== A;
    subG.b <== B;
    signal G[3];
    G <== subG.out;
    
    // F = C + G
    component addF = FieldAdd();
    addF.a <== C;
    addF.b <== G;
    signal F[3];
    F <== addF.out;
    
    // X3 = E * F
    component mulX3 = FieldMul();
    mulX3.a <== E;
    mulX3.b <== F;
    X3 <== mulX3.out;
    
    // Y3 = G * H
    component mulY3 = FieldMul();
    mulY3.a <== G;
    mulY3.b <== H;
    Y3 <== mulY3.out;
    
    // T3 = E * H
    component mulT3 = FieldMul();
    mulT3.a <== E;
    mulT3.b <== H;
    T3 <== mulT3.out;
    
    // Z3 = F * G
    component mulZ3 = FieldMul();
    mulZ3.a <== F;
    mulZ3.b <== G;
    Z3 <== mulZ3.out;
}

/*
 * Scalar Multiplication: k * P
 * 
 * Uses double-and-add algorithm with constant-time execution.
 * 
 * n: number of bits in scalar
 */
template ScalarMul(n) {
    signal input k[n];  // scalar bits, LSB first
    signal input Px[3], Py[3], Pz[3], Pt[3];
    signal output Qx[3], Qy[3], Qz[3], Qt[3];
    
    // Running sum and doubled point
    signal sumX[n+1][3], sumY[n+1][3], sumZ[n+1][3], sumT[n+1][3];
    signal dblX[n+1][3], dblY[n+1][3], dblZ[n+1][3], dblT[n+1][3];
    
    // Initialize: sum = identity (0, 1, 1, 0), dbl = P
    sumX[0][0] <== 0; sumX[0][1] <== 0; sumX[0][2] <== 0;
    sumY[0][0] <== 1; sumY[0][1] <== 0; sumY[0][2] <== 0;
    sumZ[0][0] <== 1; sumZ[0][1] <== 0; sumZ[0][2] <== 0;
    sumT[0][0] <== 0; sumT[0][1] <== 0; sumT[0][2] <== 0;
    
    dblX[0] <== Px;
    dblY[0] <== Py;
    dblZ[0] <== Pz;
    dblT[0] <== Pt;
    
    for (var i = 0; i < n; i++) {
        // Conditional add: if k[i] == 1, sum += dbl
        component add = PointAdd();
        add.X1 <== sumX[i];
        add.Y1 <== sumY[i];
        add.Z1 <== sumZ[i];
        add.T1 <== sumT[i];
        add.X2 <== dblX[i];
        add.Y2 <== dblY[i];
        add.Z2 <== dblZ[i];
        add.T2 <== dblT[i];
        
        // Select based on bit
        component selX = BigInt85Select();
        selX.a <== sumX[i];
        selX.b <== add.X3;
        selX.sel <== k[i];
        sumX[i+1] <== selX.out;
        
        component selY = BigInt85Select();
        selY.a <== sumY[i];
        selY.b <== add.Y3;
        selY.sel <== k[i];
        sumY[i+1] <== selY.out;
        
        component selZ = BigInt85Select();
        selZ.a <== sumZ[i];
        selZ.b <== add.Z3;
        selZ.sel <== k[i];
        sumZ[i+1] <== selZ.out;
        
        component selT = BigInt85Select();
        selT.a <== sumT[i];
        selT.b <== add.T3;
        selT.sel <== k[i];
        sumT[i+1] <== selT.out;
        
        // Double: dbl = 2 * dbl
        component dbl = PointDouble();
        dbl.X1 <== dblX[i];
        dbl.Y1 <== dblY[i];
        dbl.Z1 <== dblZ[i];
        dbl.T1 <== dblT[i];
        
        dblX[i+1] <== dbl.X3;
        dblY[i+1] <== dbl.Y3;
        dblZ[i+1] <== dbl.Z3;
        dblT[i+1] <== dbl.T3;
    }
    
    Qx <== sumX[n];
    Qy <== sumY[n];
    Qz <== sumZ[n];
    Qt <== sumT[n];
}

/*
 * Point Compression
 * 
 * Compress extended coordinates to standard Ed25519 format:
 * 32 bytes = Y coordinate with sign of X in MSB
 */
template PointCompress() {
    signal input X[3], Y[3], Z[3];
    signal output compressed[256]; // bits
    
    // Compute affine coordinates: x = X/Z, y = Y/Z
    component invZ = FieldInv();
    invZ.a <== Z;
    
    component mulX = FieldMul();
    mulX.a <== X;
    mulX.b <== invZ.out;
    signal x[3];
    x <== mulX.out;
    
    component mulY = FieldMul();
    mulY.a <== Y;
    mulY.b <== invZ.out;
    signal y[3];
    y <== mulY.out;
    
    // Convert y to bits
    component y2bits = Num2Bits(255);
    component limbs2num = Limbs2Num();
    limbs2num.limbs <== y;
    y2bits.in <== limbs2num.out;
    
    for (var i = 0; i < 255; i++) {
        compressed[i] <== y2bits.out[i];
    }
    
    // Sign bit of x (LSB of x)
    compressed[255] <== x[0] & 1;
}

/*
 * Point Decompression (Verification)
 * 
 * Given compressed point and claimed uncompressed (x, y),
 * verify that compression of (x, y) equals the compressed input.
 * 
 * This is the "deferral" strategy - we take uncompressed as witness
 * and verify the compression matches.
 */
template PointDecompressVerify() {
    signal input compressed[256]; // compressed point bits
    signal input x[3], y[3];      // claimed uncompressed coordinates
    signal output valid;
    
    // Verify y matches (first 255 bits)
    component limbs2num = Limbs2Num();
    limbs2num.limbs <== y;
    
    component y2bits = Num2Bits(255);
    y2bits.in <== limbs2num.out;
    
    signal yMatch[255];
    signal yMatchProd[256];
    yMatchProd[0] <== 1;
    
    for (var i = 0; i < 255; i++) {
        component eq = IsZero();
        eq.in <== y2bits.out[i] - compressed[i];
        yMatch[i] <== eq.out;
        yMatchProd[i+1] <== yMatchProd[i] * yMatch[i];
    }
    
    // Verify sign bit of x matches
    signal xSign;
    xSign <== x[0] & 1;
    
    component signEq = IsZero();
    signEq.in <== xSign - compressed[255];
    
    // Verify point is on curve: -x^2 + y^2 = 1 + d*x^2*y^2
    component x2 = FieldSquare();
    x2.a <== x;
    
    component y2 = FieldSquare();
    y2.a <== y;
    
    // LHS = -x^2 + y^2 = y^2 - x^2
    component lhs = FieldSub();
    lhs.a <== y2.out;
    lhs.b <== x2.out;
    
    // RHS = 1 + d*x^2*y^2
    component x2y2 = FieldMul();
    x2y2.a <== x2.out;
    x2y2.b <== y2.out;
    
    signal d[3];
    var dLimbs[3] = ED25519_D();
    d[0] <-- dLimbs[0];
    d[1] <-- dLimbs[1];
    d[2] <-- dLimbs[2];
    
    component dx2y2 = FieldMul();
    dx2y2.a <== d;
    dx2y2.b <== x2y2.out;
    
    signal one[3];
    one[0] <== 1;
    one[1] <== 0;
    one[2] <== 0;
    
    component rhs = FieldAdd();
    rhs.a <== one;
    rhs.b <== dx2y2.out;
    
    // Check LHS == RHS
    component curveEq = FieldEqual();
    curveEq.a <== lhs.out;
    curveEq.b <== rhs.out;
    
    valid <== yMatchProd[255] * signEq.out * curveEq.out;
}
