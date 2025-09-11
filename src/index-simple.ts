import express, { Request, Response } from 'express';
import { Client, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Get Chromium path for Railway deployment
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

console.log('🚀 Starting WhatsApp Bot...');
console.log('🔍 Chromium path:', CHROMIUM_PATH);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Simple WhatsApp client following official documentation
const client = new Client({
    puppeteer: {
        headless: true,
        executablePath: CHROMIUM_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// QR Code event
client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
});

// Ready event
client.on('ready', () => {
    console.log('Client is ready!');
});

// Message event - following official documentation exactly
client.on('message', msg => {
    console.log('MESSAGE RECEIVED:', msg.from, msg.body);
    
    if (msg.body == '!ping') {
        msg.reply('pong');
        console.log('Replied with pong');
    }
});

// Error handling
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Client was logged out:', reason);
});

// Initialize client
console.log('🔄 Initializing WhatsApp client...');
client.initialize();

// Simple Express server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
    console.log(`🏥 Health check available at: http://localhost:${PORT}/health`);
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        message: 'WhatsApp Bot is running',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

// Root endpoint
app.get('/', (req: Request, res: Response) => {
    res.status(200).json({ 
        message: 'WhatsApp Bot API',
        status: 'running',
        endpoints: ['/health', '/test']
    });
});

// Test endpoint to check client status
app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({ 
        message: 'Test endpoint',
        clientState: 'checking...',
        chromiumPath: CHROMIUM_PATH,
        environment: process.env.NODE_ENV || 'development'
    });
});
