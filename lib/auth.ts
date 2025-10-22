import * as jose from 'jose';

const privateKeyPem = process.env.JWT_PRIVATE_KEY;
const workerPublicKeyPem = process.env.WORKER_PUBLIC_KEY;
const expressServerUrl = process.env.EXPRESS_SERVER_URL;

/**
 * Generates a signed JWT for authenticating requests to the Worker
 * Uses RS256 algorithm with 5-minute expiration
 */
export async function generateWorkerAuthToken(audience: string): Promise<string> {
  if (!privateKeyPem) {
    throw new Error('JWT_PRIVATE_KEY environment variable is not set');
  }
  if (!audience) {
    throw new Error('Audience must be provided');
  }

  // Import the private key for RS256 signing
  const privateKey = await jose.importPKCS8(privateKeyPem, 'RS256');

  // Create JWT with required claims
  const jwt = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt()
    .setAudience(audience)
    .setExpirationTime('5m') // 5 minutes from now
    .sign(privateKey);

  return jwt;
}

/**
 * Verifies a JWT token from the Worker in incoming Express requests
 * Returns the verified payload or null if verification fails
 */
export async function verifyWorkerAuthToken(token: string): Promise<jose.JWTVerifyResult | null> {
  try {
    if (!workerPublicKeyPem) {
      throw new Error('WORKER_PUBLIC_KEY environment variable is not set');
    }
    if (!expressServerUrl) {
      throw new Error('EXPRESS_SERVER_URL environment variable is not set');
    }

    // Import the public key for RS256 verification
    const publicKey = await jose.importSPKI(workerPublicKeyPem, 'RS256');

    // Verify the JWT
    const result = await jose.jwtVerify(token, publicKey, {
      audience: expressServerUrl,
      algorithms: ['RS256'],
    });

    return result;
  } catch (error) {
    console.error('Worker JWT verification failed:', error);
    return null;
  }
}

/**
 * Express middleware to verify Worker authentication
 * Usage: app.post('/endpoint', verifyWorkerAuth, (req, res) => { ... })
 */
export async function verifyWorkerAuth(req: any, res: any, next: any) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing token' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const verified = await verifyWorkerAuthToken(token);

    if (!verified) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Store verified payload in request for later use
    req.workerAuth = verified.payload;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
