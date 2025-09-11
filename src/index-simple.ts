import express, { Request, Response } from 'express';
import { Client, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Get Chromium path for Railway deployment
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

console.log('🚀 Starting WhatsApp Bot...');
console.log('🔍 Chromium path:', CHROMIUM_PATH);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// Verify Chromium exists
if (fs.existsSync(CHROMIUM_PATH)) {
    console.log('✅ Chromium executable found');
} else {
    console.log('❌ Chromium executable NOT found at:', CHROMIUM_PATH);
    console.log('🔍 Trying alternative paths...');
    
    const alternativePaths = [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ];
    
    let foundPath = null;
    for (const path of alternativePaths) {
        if (fs.existsSync(path)) {
            foundPath = path;
            console.log('✅ Found Chromium at:', path);
            break;
        }
    }
    
    if (!foundPath) {
        console.log('❌ No Chromium executable found in any common location');
    }
}

// Simple WhatsApp client following official documentation
const client = new Client({
    puppeteer: {
        headless: true,
        executablePath: CHROMIUM_PATH,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// QR Code event - handles both initial and refresh
client.on('qr', (qr) => {
    console.log('🔄 QR Code received/refreshed');
    console.log('QR Code:', qr);
    currentQR = qr; // Store current QR code
    qrcode.generate(qr, { small: true });
    console.log('📱 Open WhatsApp on your phone and scan the QR code above');
    console.log('⏰ QR code expires in 120 seconds - you have time to scan!');
    console.log('💡 If QR expires, it will automatically refresh');
    
    // Set up timeout for QR code refresh
    setupQRTimeout();
});

// Ready event
client.on('ready', () => {
    console.log('✅ Client is ready!');
    console.log('🤖 Bot is now active and listening for messages');
    
    // Clear QR timeout and QR code since we're now authenticated
    if (qrTimeout) {
        clearTimeout(qrTimeout);
        qrTimeout = null;
        console.log('✅ QR timeout cleared - authentication successful');
    }
    currentQR = null; // Clear stored QR code
    
    // Test if we can get client info
    console.log('🔍 Client info:', client.info);
    console.log('🔍 Client state:', client.getState());
    
    // Test message sending capability
    setTimeout(async () => {
        try {
            const chats = await client.getChats();
            console.log(`🧪 Found ${chats.length} chats - client is working`);
            
            if (chats.length > 0) {
                const firstChat = chats[0];
                if (firstChat) {
                    console.log(`🧪 First chat: ${firstChat.name || firstChat.id._serialized}`);
                }
            }
        } catch (error) {
            console.log('🧪 Error testing client:', error);
        }
    }, 2000);
});

// Message event - following official documentation exactly
client.on('message', msg => {
    console.log('📨 MESSAGE EVENT TRIGGERED');
    console.log('📨 From:', msg.from);
    console.log('📨 Body:', msg.body);
    console.log('📨 Type:', msg.type);
    console.log('📨 Timestamp:', msg.timestamp);
    console.log('📨 Is from me:', msg.fromMe);
    
    if (msg.body == '!ping') {
        console.log('🏓 Ping detected, sending pong...');
        msg.reply('pong').then(() => {
            console.log('✅ Pong sent successfully');
        }).catch(err => {
            console.error('❌ Error sending pong:', err);
        });
    }
});

// Also listen for message_create event (sometimes needed)
client.on('message_create', msg => {
    console.log('📨 MESSAGE_CREATE EVENT TRIGGERED');
    console.log('📨 From:', msg.from);
    console.log('📨 Body:', msg.body);
    console.log('📨 Is from me:', msg.fromMe);
    
    if (!msg.fromMe && msg.body == '!ping') {
        console.log('🏓 Ping detected in message_create, sending pong...');
        msg.reply('pong').then(() => {
            console.log('✅ Pong sent successfully via message_create');
        }).catch(err => {
            console.error('❌ Error sending pong via message_create:', err);
        });
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

// Catch all events for debugging
client.on('*', (eventName, ...args) => {
    console.log(`🔍 EVENT: ${eventName}`, args.length > 0 ? args : '');
});

// QR code timeout mechanism
let qrTimeout: NodeJS.Timeout | null = null;
let currentQR: string | null = null;

// Initialize client
console.log('🔄 Initializing WhatsApp client...');
console.log('🔍 Chromium executable path:', CHROMIUM_PATH);
console.log('🔍 Puppeteer args:', [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process',
    '--disable-gpu'
]);

client.initialize().then(() => {
    console.log('✅ Client initialization started');
}).catch(err => {
    console.error('❌ Client initialization failed:', err);
});

// Add a timeout to detect if client gets stuck
setTimeout(() => {
    console.log('⏰ 30 seconds passed - checking client state...');
    client.getState().then(state => {
        console.log('🔍 Current client state:', state);
        if (state !== 'CONNECTED') {
            console.log('⚠️ Client not connected after 30 seconds');
            console.log('🔄 Attempting to restart client...');
            client.destroy().then(() => {
                console.log('🔄 Client destroyed, reinitializing...');
                client.initialize();
            });
        }
    }).catch(err => {
        console.error('❌ Error checking client state:', err);
    });
}, 30000);

// Set up QR code timeout (refresh every 120 seconds if not scanned)
const setupQRTimeout = () => {
    if (qrTimeout) clearTimeout(qrTimeout);
    qrTimeout = setTimeout(() => {
        console.log('⏰ QR code timeout after 120 seconds - refreshing...');
        client.logout().then(() => {
            console.log('🔄 Logged out due to timeout, generating new QR');
            client.initialize();
        }).catch(err => {
            console.error('❌ Error during timeout logout:', err);
        });
    }, 120000); // 120 seconds - longer timeout
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
        chromiumExists: fs.existsSync(CHROMIUM_PATH),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Get current QR code endpoint
app.get('/qr', (req: Request, res: Response) => {
    if (currentQR) {
        res.status(200).json({ 
            qr: currentQR,
            message: 'Current QR code',
            expiresIn: '120 seconds'
        });
    } else {
        res.status(404).json({ 
            message: 'No QR code available',
            suggestion: 'Try /qr-refresh to generate a new QR code'
        });
    }
});

// QR refresh endpoint
app.get('/qr-refresh', (req: Request, res: Response) => {
    console.log('🔄 Manual QR refresh requested');
    
    // Clear existing timeout
    if (qrTimeout) {
        clearTimeout(qrTimeout);
        qrTimeout = null;
    }
    
    // Try to destroy and reinitialize client
    client.destroy().then(() => {
        console.log('🔄 Client destroyed, reinitializing...');
        client.initialize();
        res.status(200).json({ message: 'QR refresh initiated' });
    }).catch(err => {
        console.error('❌ Error during client destroy:', err);
        // Fallback: just reinitialize
        console.log('🔄 Fallback: reinitializing without destroy');
        client.initialize();
        res.status(200).json({ message: 'QR refresh initiated (fallback)' });
    });
});

// Test message endpoint
app.post('/test-message', async (req: Request, res: Response) => {
    const { to, message } = req.body;
    
    if (!to || !message) {
        res.status(400).json({ error: 'Missing to or message' });
        return;
    }
    
    try {
        console.log(`🧪 Testing message to ${to}: ${message}`);
        const result = await client.sendMessage(to, message);
        console.log('✅ Test message sent:', result.id._serialized);
        res.status(200).json({ 
            message: 'Test message sent',
            messageId: result.id._serialized
        });
    } catch (error) {
        console.error('❌ Error sending test message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Client status endpoint
app.get('/client-status', async (req: Request, res: Response) => {
    try {
        const state = await client.getState();
        const info = client.info;
        const chats = await client.getChats();
        
        res.status(200).json({
            state: state,
            info: info,
            chatCount: chats.length,
            isReady: state === 'CONNECTED',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting client status:', error);
        res.status(500).json({ error: 'Failed to get client status' });
    }
});
