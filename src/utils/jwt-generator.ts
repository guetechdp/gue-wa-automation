import { Environment } from '../types';
import { getSignJWT, getJoseModule } from './jose-import';
import crypto from 'crypto';

export class JWTGenerator {
    private jwtSecret: string;

    constructor(env: Environment) {
        this.jwtSecret = env.WA_JWT_SECRET || '';
        if (!this.jwtSecret) {
            throw new Error('WA_JWT_SECRET is required for JWT generation');
        }
    }

    /**
     * Generate a JWT token for testing
     */
    public async generateToken(payload: any = {}): Promise<string> {
        const defaultPayload = {
            sub: 'test-user',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
            ...payload
        };

        const SignJWT = await getSignJWT();
        const key = await this.getJWTKey();
        
        const jwt = await new SignJWT(defaultPayload)
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .sign(key);

        return jwt;
    }

    /**
     * Generate a test token for API testing
     */
    public async generateTestToken(): Promise<string> {
        return this.generateToken({
            sub: 'test-user',
            name: 'Test User',
            role: 'admin'
        });
    }

    /**
     * Get JWT signing key
     */
    private async getJWTKey(): Promise<any> {
        // Convert secret to Uint8Array for jose library
        return new TextEncoder().encode(this.jwtSecret);
    }
}

/**
 * Create JWT generator instance
 */
export const createJWTGenerator = (env: Environment): JWTGenerator => {
    return new JWTGenerator(env);
};
