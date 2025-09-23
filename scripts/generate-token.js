#!/usr/bin/env node

/**
 * Secure JWT Token Generator Script
 * 
 * This script generates JWT tokens for API authentication.
 * It should only be run locally by authorized developers.
 * 
 * Usage:
 *   node scripts/generate-token.js
 *   node scripts/generate-token.js --payload '{"sub":"user123","role":"admin"}'
 */

require('dotenv/config');

async function generateToken() {
    try {
        // Get JWT secret from environment
        const jwtSecret = process.env.WA_JWT_SECRET;
        if (!jwtSecret) {
            console.error('❌ WA_JWT_SECRET environment variable is required');
            console.error('   Please set WA_JWT_SECRET in your .env file');
            process.exit(1);
        }

        // Parse custom payload from command line arguments
        let customPayload = {};
        const args = process.argv.slice(2);
        if (args.includes('--payload')) {
            const payloadIndex = args.indexOf('--payload');
            if (payloadIndex + 1 < args.length) {
                try {
                    customPayload = JSON.parse(args[payloadIndex + 1]);
                } catch (error) {
                    console.error('❌ Invalid JSON in --payload argument');
                    process.exit(1);
                }
            }
        }

        // Default payload
        const defaultPayload = {
            sub: 'admin-user',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
            role: 'admin',
            name: 'Admin User'
        };

        // Merge with custom payload
        const payload = { ...defaultPayload, ...customPayload };

        // Generate JWT key
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(jwtSecret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        // Generate token
        const { SignJWT } = await import('jose');
        const token = await new SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .sign(key);

        console.log('🔐 JWT Token Generated Successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('📋 Token:');
        console.log(token);
        console.log('');
        console.log('📋 Payload:');
        console.log(JSON.stringify(payload, null, 2));
        console.log('');
        console.log('🔧 Usage:');
        console.log(`curl -H "Authorization: Bearer ${token}" \\`);
        console.log('     "http://localhost:3003/api/health"');
        console.log('');
        console.log('⚠️  Security Notes:');
        console.log('   • Keep this token secure and do not share it');
        console.log('   • Token expires in 24 hours');
        console.log('   • Generate new tokens as needed');
        console.log('   • Do not commit tokens to version control');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error('❌ Error generating JWT token:', error.message);
        process.exit(1);
    }
}

// Run the script
generateToken();
