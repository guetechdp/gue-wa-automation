import 'dotenv/config';
import { WhatsAppBotApp } from './app';
import { Environment } from './types';
import fs from 'fs';

// Environment configuration
const env: Environment = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    CHROMIUM_PATH: process.env.CHROMIUM_PATH || undefined,
    FW_ENDPOINT: process.env.FW_ENDPOINT || undefined,
    JWT_SECRET: process.env.JWT_SECRET || undefined,
    WA_JWT_SECRET: process.env.WA_JWT_SECRET || undefined,
    PORT: process.env.PORT || '8080',
    MONGODB_URI: process.env.MONGODB_URI || undefined,
    M_WAITING_TIME: process.env.M_WAITING_TIME || '30000',
    AI_AGENT: process.env.AI_AGENT || 'FW',
    UPLOAD_USER_ID: process.env.UPLOAD_USER_ID || undefined,
    UPLOAD_AUTH_TOKEN: process.env.UPLOAD_AUTH_TOKEN || undefined,
    AUTO_RESTART_CRON: process.env.AUTO_RESTART_CRON || undefined
};

// Validate required environment variables
if (!env.MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI environment variable is not set. The application will not be able to connect to MongoDB.');
    console.warn('⚠️ Please set MONGODB_URI environment variable for full functionality.');
}

// Detect Chromium path
let BROWSER_PATH: string | undefined;
if (env.CHROMIUM_PATH) {
    BROWSER_PATH = env.CHROMIUM_PATH;
    } else {
    const possiblePaths = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ];
    
    for (const path of possiblePaths) {
        if (fs.existsSync(path)) {
            BROWSER_PATH = path;
            break;
        }
    }
}

if (!BROWSER_PATH) {
    console.error('❌ Chromium browser not found. Please set CHROMIUM_PATH environment variable.');
    process.exit(1);
}

console.log(`🌐 Using Chromium at: ${BROWSER_PATH}`);

// Update environment with detected browser path
env.CHROMIUM_PATH = BROWSER_PATH;

// Create and start the application
const app = new WhatsAppBotApp(env);
const port = parseInt(env.PORT || '8080', 10);

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await app.gracefulShutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await app.gracefulShutdown();
    process.exit(0);
});

// Start the application
app.start(port).catch((error) => {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
});
