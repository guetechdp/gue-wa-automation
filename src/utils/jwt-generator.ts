import { Environment } from '../types';

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

        const { SignJWT } = await import('jose');
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
        return await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(this.jwtSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
    }
}

/**
 * Create JWT generator instance
 */
export const createJWTGenerator = (env: Environment): JWTGenerator => {
    return new JWTGenerator(env);
};
