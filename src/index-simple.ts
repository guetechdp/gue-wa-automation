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

// QR Code event - handles both initial and refresh
client.on('qr', (qr) => {
    console.log('🔄 QR Code received/refreshed');
    console.log('QR Code:', qr);
    qrcode.generate(qr, { small: true });
    console.log('📱 Open WhatsApp on your phone and scan the QR code above');
    console.log('⏰ QR code expires in 60 seconds - scan quickly!');
    
    // Set up timeout for QR code refresh
    setupQRTimeout();
});

// Ready event
client.on('ready', () => {
    console.log('✅ Client is ready!');
    console.log('🤖 Bot is now active and listening for messages');
    
    // Clear QR timeout since we're now authenticated
    if (qrTimeout) {
        clearTimeout(qrTimeout);
        qrTimeout = null;
        console.log('✅ QR timeout cleared - authentication successful');
    }
});

// Message event - following official documentation exactly
client.on('message', msg => {
    console.log('📨 MESSAGE RECEIVED:', msg.from, msg.body);
    
    if (msg.body == '!ping') {
        msg.reply('pong');
        console.log('✅ Replied with pong');
    }
});

// Error handling
client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('❌ Client was logged out:', reason);
    console.log('🔄 Attempting to reconnect...');
});

// Handle loading screen
client.on('loading_screen', (percent, message) => {
    console.log(`🔄 Loading: ${percent}% - ${message}`);
});

// QR code timeout mechanism
let qrTimeout: NodeJS.Timeout | null = null;

// Initialize client
console.log('🔄 Initializing WhatsApp client...');
client.initialize();

// Set up QR code timeout (refresh every 60 seconds if not scanned)
const setupQRTimeout = () => {
    if (qrTimeout) clearTimeout(qrTimeout);
    qrTimeout = setTimeout(() => {
        console.log('⏰ QR code timeout - refreshing...');
        client.logout().then(() => {
            console.log('🔄 Logged out due to timeout, generating new QR');
            client.initialize();
        }).catch(err => {
            console.error('❌ Error during timeout logout:', err);
        });
    }, 60000); // 60 seconds
};

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

// QR refresh endpoint
app.get('/qr-refresh', (req: Request, res: Response) => {
    console.log('🔄 Manual QR refresh requested');
    client.logout().then(() => {
        console.log('🔄 Logged out, will generate new QR code');
        client.initialize();
        res.status(200).json({ message: 'QR refresh initiated' });
    }).catch(err => {
        console.error('❌ Error during logout:', err);
        res.status(500).json({ error: 'Failed to refresh QR' });
    });
});
