import { Environment } from '../types';
import jwt from 'jsonwebtoken';

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

        return jwt.sign(defaultPayload, this.jwtSecret, { algorithm: 'HS256' });
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

}

/**
 * Create JWT generator instance
 */
export const createJWTGenerator = (env: Environment): JWTGenerator => {
    return new JWTGenerator(env);
};
