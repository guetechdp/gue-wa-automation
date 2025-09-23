import { Request, Response, NextFunction } from 'express';
import { Environment } from '../types';
import { getJwtVerify } from '../utils/jose-import';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        [key: string]: any;
    };
}

export class AuthMiddleware {
    private jwtSecret: string;

    constructor(env: Environment) {
        this.jwtSecret = env.WA_JWT_SECRET || '';
        if (!this.jwtSecret) {
            console.warn('⚠️ WA_JWT_SECRET not set in environment variables');
        }
    }

    /**
     * JWT Authentication Middleware
     * Validates Bearer token from Authorization header
     */
    public authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            // Check if JWT secret is configured
            if (!this.jwtSecret) {
                res.status(500).json({
                    success: false,
                    error: 'Authentication not configured. WA_JWT_SECRET is required.'
                });
                return;
            }

            // Get Authorization header
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                res.status(401).json({
                    success: false,
                    error: 'Authorization header is required'
                });
                return;
            }

            // Check if it starts with 'Bearer '
            if (!authHeader.startsWith('Bearer ')) {
                res.status(401).json({
                    success: false,
                    error: 'Invalid authorization format. Expected: Bearer <token>'
                });
                return;
            }

            // Extract token
            const token = authHeader.substring(7); // Remove 'Bearer ' prefix
            if (!token) {
                res.status(401).json({
                    success: false,
                    error: 'Token is required'
                });
                return;
            }

            // Verify JWT token
            try {
                const jwtVerify = await getJwtVerify();
                const key = await this.getJWTKey();
                const { payload } = await jwtVerify(token, key);
                
                // Add user info to request
                req.user = {
                    id: payload.sub as string || 'unknown',
                    ...payload
                };

                console.log(`🔐 Authenticated user: ${req.user?.id}`);
                next();
            } catch (jwtError) {
                console.error('❌ JWT verification failed:', jwtError);
                res.status(401).json({
                    success: false,
                    error: 'Invalid or expired token'
                });
                return;
            }
        } catch (error) {
            console.error('❌ Authentication middleware error:', error);
            res.status(500).json({
                success: false,
                error: 'Authentication failed'
            });
        }
    };

    /**
     * Optional authentication middleware
     * Doesn't fail if no token is provided, but validates if present
     */
    public optionalAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const authHeader = req.headers.authorization;
            
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                // No token provided, continue without authentication
                next();
                return;
            }

            // Token provided, validate it
            await this.authenticate(req, res, next);
        } catch (error) {
            console.error('❌ Optional authentication error:', error);
            next(); // Continue without authentication on error
        }
    };

    /**
     * Get JWT verification key
     */
    private async getJWTKey(): Promise<any> {
        return await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(this.jwtSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );
    }
}

/**
 * Create authentication middleware instance
 */
export const createAuthMiddleware = (env: Environment): AuthMiddleware => {
    return new AuthMiddleware(env);
};
