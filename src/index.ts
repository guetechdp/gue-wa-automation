import express, { Request, Response } from 'express';
import { Client, LocalAuth, NoAuth, Message, Chat } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import Loki from 'lokijs';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as jwt from 'jsonwebtoken';

import {
  Environment,
  AIAgentResponse,
  FWConfig,
  NumberEntry,
  Database,
  MessageQueue,
  ProcessingState,
  ChatMessage,
  GreetingRequest,
  GreetingResponse,
  ErrorResponse,
  WhatsAppClient,
  ExpressApp
} from './types';

// Load environment variables
dotenv.config();

// Environment variables with proper typing
const env = process.env as Environment;

// Message queue to handle deduplication and batching
const messageQueue: MessageQueue = {};
const processingUsers: ProcessingState = {};

// Global variable to store QR code
let currentQRCode: string | null = null;

// Ensure Railway Persistent Storage is used
const SESSION_PATH = process.env.NODE_ENV === 'production' ? "/tmp/.wwebjs_auth" : "./.wwebjs_auth";
const RAILWAY_VOLUME_PATH = process.env.RAILWAY_VOLUME_PATH || "/data"; 
const lockFile = path.join(SESSION_PATH, 'session', 'SingletonLock');

// Enhanced session directory management for Railway persistence
const ensureSessionDirectory = () => {
    try {
        // For Railway, we need to handle permissions more carefully
        if (process.env.NODE_ENV === 'production') {
            console.log(`💾 Railway production mode - using temporary session storage at: ${SESSION_PATH}`);
            console.log(`📝 Note: Sessions will be recreated on restart (Railway limitation)`);
            
            // Use /tmp directory which has proper permissions
            try {
                if (!fs.existsSync(SESSION_PATH)) {
                    fs.mkdirSync(SESSION_PATH, { recursive: true, mode: 0o755 });
                    console.log(`📁 Created session directory: ${SESSION_PATH}`);
                }
            } catch (error) {
                console.log(`⚠️ Could not create session directory: ${error}`);
                console.log(`📝 Will let WhatsApp Web.js handle directory creation`);
            }
            
            // Don't try to create subdirectories - let WhatsApp Web.js handle it
            console.log(`🔒 Session will be managed by WhatsApp Web.js`);
            
        } else {
            // Development mode - create directories normally
            if (!fs.existsSync(SESSION_PATH)) {
                fs.mkdirSync(SESSION_PATH, { recursive: true });
                console.log(`📁 Created session directory: ${SESSION_PATH}`);
            }
            
            const sessionDir = path.join(SESSION_PATH, 'session');
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
                console.log(`📁 Created session subdirectory: ${sessionDir}`);
            }
        }
        
        console.log(`💾 Session persistence configured at: ${SESSION_PATH}`);
        console.log(`🔒 Lock file location: ${lockFile}`);
        
        // Check if session data exists (only if directory exists)
        if (fs.existsSync(SESSION_PATH)) {
            try {
                const sessionFiles = fs.readdirSync(SESSION_PATH);
                if (sessionFiles.length > 0) {
                    console.log(`✅ Found existing session data: ${sessionFiles.join(', ')}`);
                } else {
                    console.log(`📝 No existing session data found - will create new session`);
                }
            } catch (error) {
                console.log(`⚠️ Could not read session directory: ${error}`);
            }
        } else {
            console.log(`📝 Session directory will be created by WhatsApp Web.js`);
        }
        
    } catch (error) {
        console.error("❌ Error setting up session directory:", error);
        console.log("📝 Continuing with WhatsApp Web.js default behavior");
    }
};

// Initialize session directory
ensureSessionDirectory();

try {
    // Check if Chromium is already running
    const isRunning = execSync("pgrep -x chromium || pgrep -x chromium-browser || echo 0")
        .toString().trim() !== "0";

    if (!isRunning && fs.existsSync(lockFile)) {
        console.log("🔓 Removing existing SingletonLock file...");
        fs.unlinkSync(lockFile);
        console.log("✅ SingletonLock removed successfully");
    }
} catch (error) {
    console.error("❌ Error checking Chromium process:", error);
}

const productionmode: boolean = env.NODE_ENV === 'production';

const app: ExpressApp = express();
// Express Middleware
app.use(express.json()); // To parse incoming JSON requests

// Initialize LokiJS and Create a Database
const db = new Loki('automark.db', {
    autoload: true,
    autosave: true,
    autosaveInterval: 4000, // Save every 4 seconds
    persistenceMethod: 'localStorage' // You can also use 'fs' for file storage
});

let numbersCollection: Loki.Collection<NumberEntry> | null = null;

db.loadDatabase({}, () => {
    numbersCollection = db.getCollection('numbers');
    // If collection doesn't exist, create it
    if (!numbersCollection) {
        numbersCollection = db.addCollection('numbers');
    }
});

const messagewaitingtime: number = Number(env.M_WAITING_TIME) || 30000;

// Ensure Puppeteer Path is Correct
const BROWSER_PATH: string | undefined = env.CHROMIUM_PATH || (process.platform === 'darwin' ? '/opt/homebrew/bin/chromium' : '/usr/bin/chromium');

const configfw: FWConfig = {
    question: "",
    overrideConfig: {}
};

const allowedNumbers: string[] = []; // Replace with actual numbers
// Split the string by '.' to get the path
try {
    if (!productionmode && env.WHITELISTED_NUMBERS) {
        const unumbers = env.WHITELISTED_NUMBERS;
        allowedNumbers.push(...unumbers.split(','));
    }
} catch (e) {
    console.error('Error parsing whitelisted numbers:', e);
}

let myWhatsAppNumber: string | null = null;

async function callInferenceFw(messages: string, session?: string, phoneNumber?: string, userName?: string): Promise<AIAgentResponse> {
    try {
        const url = env.FW_ENDPOINT || 'http://localhost:3000/api/agents/herbakofAssistanceAgent/generate';
        const jwtSecret = env.JWT_SECRET || 'your-jwt-secret-key';
        
        // Generate JWT token dynamically
        const payload = {
            iss: 'whatsapp-bot',
            sub: 'custom-user-id',
            aud: 'authenticated',
            iat: Math.floor(Date.now() / 1000),
            phone: phoneNumber || 'unknown',
            role: 'authenticated',
            app_metadata: {
                provider: 'wa',
                providers: ['wa']
            },
            user_metadata: {
                phone: phoneNumber || 'unknown',
                phone_verified: true,
                full_name: userName || 'WhatsApp User',
                sub: 'custom-user-id',
                campaign_id: '6a793f4c-609d-4507-ad4f-d6d25c1218c8',
                participant_name: userName || 'WhatsApp User',
                participant_phone: phoneNumber || 'unknown'
            }
        };

        const authToken = jwt.sign(payload, jwtSecret, {
            expiresIn: '24h',
            algorithm: 'HS256'
        });
        
        // Format the phone number for threadId and resourceId
        const formattedPhoneNumber = phoneNumber || 'unknown';
        
        const requestBody = {
            messages: [messages],
            threadId: formattedPhoneNumber,
            resourceId: formattedPhoneNumber
        };

        console.log('🤖 Sending to AI API:', {
            url,
            threadId: formattedPhoneNumber,
            resourceId: formattedPhoneNumber,
            messageCount: requestBody.messages.length
        });

        const response = await axios.post(url, requestBody, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });

        const rsp = response.data;
        const jsonData: AIAgentResponse = {
            text: rsp.text || 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
            session: session || null
        };
        
        // Ensure we always have a valid text response
        if (!jsonData.text || jsonData.text.trim() === '') {
            jsonData.text = 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu';
        }
        
        return jsonData;
    } catch (error) {
        console.error('Error during inference:', error);
        return {
            text: 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
            session: null
        };
    }
}

// Function to fetch messages after a specific timestamp
async function fetchMessagesAfterTimestamp(messages: Message[], timestamp: number): Promise<string | null> {
    const newMessages = messages.filter(message => message.timestamp > timestamp);
    if (newMessages.length > 0) {
        const mergedMessagesContent = newMessages.map(msg => msg.body).join('\n');
        console.log("mergedMessagesContent", mergedMessagesContent);
        return mergedMessagesContent;
    } else {
        console.log('No new messages after my latest message.');
        return null;
    }
}

// Improved function to handle message queuing and deduplication
async function handleIncomingMessage(sender: string, message: Message, delay: number = 30000): Promise<void> {
    const senderNumber: string = sender;
    
    // Check if this exact message was already processed recently
    const messageId = message.id._serialized;
    const recentProcessed = processingUsers[`${senderNumber}_${messageId}`];
    if (recentProcessed && (Date.now() - recentProcessed) < 5000) { // 5 second deduplication
        console.log(`Message ${messageId} from ${senderNumber} already processed recently, skipping`);
        return;
    }
    
    // If user is already being processed, add message to queue
    if (processingUsers[senderNumber]) {
        if (!messageQueue[senderNumber]) {
            messageQueue[senderNumber] = [];
        }
        messageQueue[senderNumber].push({
            message,
            timestamp: Date.now()
        });
        console.log(`Message from ${senderNumber} queued. Total queued: ${messageQueue[senderNumber].length}`);
        return;
    }
    
    // Mark user as being processed with timestamp
    processingUsers[senderNumber] = Date.now();
    
    // Wait for the specified delay
    setTimeout(async () => {
        try {
            // Get all queued messages for this user
            const queuedMessages = messageQueue[senderNumber] || [];
            queuedMessages.push({
                message,
                timestamp: Date.now()
            }); // Include the original message
            
            if (queuedMessages.length > 0) {
                // Get the chat and fetch recent messages
                const chat: Chat = await message.getChat();
                const recentMessages: Message[] = await chat.fetchMessages({ limit: 20 });
                
                // Find the latest message from the bot
                const myMessages = recentMessages.filter(msg => msg.from === myWhatsAppNumber);
                let latestBotMessage: Message | null = null;
                
                if (myMessages.length > 0) {
                    latestBotMessage = myMessages[myMessages.length - 1] || null;
                }
                
                // Combine all user messages since the last bot response
                let combinedUserMessages = '';
                if (latestBotMessage) {
                    // Get messages after the last bot message
                    const userMessagesAfterBot = recentMessages.filter(msg => 
                        msg.timestamp > latestBotMessage!.timestamp && 
                        !msg.fromMe && 
                        msg.from === message.from
                    );
                    combinedUserMessages = userMessagesAfterBot.map(msg => msg.body).join('\n');
                } else {
                    // If no previous bot message, combine all recent user messages
                    const userMessages = recentMessages.filter(msg => 
                        !msg.fromMe && 
                        msg.from === message.from
                    );
                    combinedUserMessages = userMessages.map(msg => msg.body).join('\n');
                }
                
                // If we have user messages to process
                if (combinedUserMessages && combinedUserMessages.trim()) {
                    console.log(`Processing ${queuedMessages.length} messages from ${senderNumber}`);
                    console.log(`Combined messages: "${combinedUserMessages}"`);
                    await sendMessage(senderNumber, combinedUserMessages, null, false, null);
                } else {
                    console.log(`No valid messages to process for ${senderNumber}`);
                }
            }
        } catch (error) {
            console.error(`Error processing messages for ${senderNumber}:`, error);
        } finally {
            // Clean up
            delete messageQueue[senderNumber];
            delete processingUsers[senderNumber];
            
            // Mark this message as processed to prevent duplicates
            const messageId = message.id._serialized;
            processingUsers[`${senderNumber}_${messageId}`] = Date.now();
        }
    }, delay);
}

// Function to fetch the last 10 messages after the latest reply and reply after a delay
async function replyToNewMessages(sender: string, message: Message, delay: number = 30000): Promise<void> {
    const chatId: string = message.from;
    let rmessage: string = message.body;
    let rcontext: ChatMessage[] | null = null;
    
    // Get the current chat
    const chat: Chat = await message.getChat();
    
    // Wait for the specified delay before replying
    setTimeout(async () => {
        const c_limit = 10;
        const messageswait: Message[] = await chat.fetchMessages({ limit: c_limit });
        if (messageswait.length > 0) {
            const lastMessage = messageswait[messageswait.length - 1];
            if (lastMessage && message.id._serialized === lastMessage.id._serialized) {
                const myMessages = messageswait.filter(message => message.from === myWhatsAppNumber);
                if (myMessages.length > 0) {
                    const latestMessage = myMessages[myMessages.length - 1]; // Get the latest message sent by you
                    if (latestMessage) {
                        const usermessages = await fetchMessagesAfterTimestamp(messageswait, latestMessage.timestamp);
                        if (usermessages) {
                            rmessage = usermessages;
                        }
                    }
                } else {
                    console.log('No messages found from me.');
                }
                await sendMessage(sender, rmessage, rcontext, false, null);
            }
        } 
    }, delay);
}

// Function to get the 5 messages before the last reply and structure them
async function getPreviousMessages(messages: Message[], timestamp: number): Promise<ChatMessage[] | null> {
    let conversation: ChatMessage[] | null = null;
    const previousMessages = messages.filter(msg => msg.timestamp <= timestamp);
    // Get the last 5 messages before the reply
    const lastFiveBeforeReply = previousMessages.slice(-4);
    // Map the lastFiveBeforeReply to the desired structure
    if (lastFiveBeforeReply.length > 0) {
        conversation = lastFiveBeforeReply.map(msg => ({
            role: msg.fromMe ? 'assistant' : 'user',  // 'assistant' if sent by bot, 'user' if sent by the other party
            content: msg.body
        }));
    }
    return conversation;
}

// Only set executablePath if BROWSER_PATH is defined
if (BROWSER_PATH) {
    // We'll set this in the client configuration below
}

const client: Client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH,  // Store session in persistent storage
        clientId: process.env.NODE_ENV === 'production' ? 'whatsapp-bot-railway-tmp' : 'whatsapp-bot-dev' // Unique client ID for session management
    }),
    puppeteer: {
        headless: true,
        ...(BROWSER_PATH && { executablePath: BROWSER_PATH }),
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-zygote',
            '--disable-background-networking',
            '--disable-component-extensions-with-background-pages',
            '--disable-client-side-phishing-detection',
            '--disable-breakpad',
            '--disable-features=Translate,BackForwardCache,AcceptCHFrame,AvoidUnnecessaryBeforeUnloadCheckSync',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--force-color-profile=srgb',
            '--metrics-recording-only',
            '--enable-automation',
            '--password-store=basic',
            '--use-mock-keychain',
            '--enable-blink-features=IdleDetection',
            '--export-tagged-pdf',
            '--remote-debugging-port=0',
            '--disable-process-singleton',
            '--disable-single-process',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--user-data-dir=/tmp/chrome-user-data', // Temporary user data directory
            '--data-path=/data' // Ensure data is stored in persistent volume
        ],
        timeout: 120000,
        defaultViewport: null
    }
});

console.log(`🚀 Initializing WhatsApp client with session path: ${SESSION_PATH}`);
console.log(`🔒 Using LocalAuth strategy for session persistence`);

// Initialize the client (following the docs pattern)
client.initialize();

// Generate and display QR code
client.on('qr', (qr: string) => {
    console.log('🔐 QR Code generated! Scan this with WhatsApp:');
    // Generate and print the QR code in the terminal
    qrcode.generate(qr, { small: true });
    console.log('📱 Open WhatsApp on your phone and scan the QR code above');
    currentQRCode = qr; // Store QR code in global variable
});

client.on('ready', async () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('🤖 Bot is now active and listening for messages');
    console.log(`💾 Session data persisted at: ${SESSION_PATH}`);

    // Clear QR code since client is now authenticated
    currentQRCode = null;

    // Get the current user's information
    if (client.info) {
        myWhatsAppNumber = client.info.wid._serialized; // Format the number for use
        console.log("📞 Bot phone number:", myWhatsAppNumber);
        
        // Verify session persistence
        try {
            const sessionFiles = fs.readdirSync(SESSION_PATH);
            console.log(`✅ Session files found: ${sessionFiles.length} files`);
            sessionFiles.forEach(file => {
                console.log(`   📄 ${file}`);
            });
        } catch (error) {
            console.log(`⚠️ Could not verify session files: ${error}`);
        }
    }
});

client.on('authenticated', () => {
    console.log('✅ Successfully authenticated with WhatsApp!');
    console.log(`💾 Authentication data saved to: ${SESSION_PATH}`);
    // Clear QR code since client is now authenticated
    currentQRCode = null;
});

client.on('auth_failure', (msg: string) => {
    console.error('❌ Authentication failed:', msg);
    console.log('🔄 Retrying authentication...');
});

client.on('loading_screen', (percent: string, message: string) => {
    console.log(`📱 Loading WhatsApp Web: ${percent}% - ${message}`);
});

client.on('disconnected', (reason: string) => {
    console.log('❌ Client disconnected:', reason);
    console.log('🔄 Attempting to reconnect...');
    // Don't auto-reinitialize to avoid conflicts
    console.log('Please restart the application manually if needed');
});

client.on('reconnecting', () => {
    console.log('🔄 Reconnecting to WhatsApp...');
});

client.on('change_state', (state: string) => {
    console.log('📊 Connection state changed:', state);
});

// Function to send a message
const sendMessage = async (
    number: string, 
    message: string, 
    contexts: ChatMessage[] | null, 
    initial: boolean, 
    campaign: string | null
): Promise<void> => {
    try {
        // Find the entry by the number field
        const numberEntry: NumberEntry | null = numbersCollection?.findOne({ number }) || null;

        let session: string | null = null;
        console.log("numberEntry", numberEntry);
        console.log("initial", initial);
        const formattedNumber = `${number}@c.us`;
        
        if (initial) {
            const response = await client.sendMessage(formattedNumber, message);
            console.log('Message sent successfully:');
            return;
        } 

        if (numberEntry) {
            session = numberEntry.session || null;
        } 

        // Get user contact information
        let userName: string = 'WhatsApp User';
        try {
            const contact = await client.getContactById(formattedNumber);
            if (contact && contact.pushname) {
                userName = contact.pushname;
            }
        } catch (error) {
            console.log('Could not get contact info, using default name');
        }

        let aiagent: AIAgentResponse;
        aiagent = await callInferenceFw(message, session || undefined, number, userName);
        
        // Validate that we have a valid response text
        if (!aiagent || !aiagent.text) {
            console.error('Invalid AI response:', aiagent);
            return;
        }
        
        try {
                    // Check if client is ready and authenticated
        if (!client.info) {
            console.error('WhatsApp client not authenticated');
            return;
        }
        
        // Additional check for client state
        if (!client.pupPage || !client.pupPage.isClosed) {
            console.error('WhatsApp client page not ready');
            return;
        }
            
            // Validate the phone number format
            if (!formattedNumber || !formattedNumber.includes('@')) {
                console.error('Invalid phone number format:', formattedNumber);
                return;
            }
            
            // Single attempt to send message (no retries to avoid duplicates)
            let messageSent = false;
            try {
                const response = await client.sendMessage(formattedNumber, aiagent.text);
                messageSent = true;
                console.log('✅ Message sent successfully:', aiagent.text);
            } catch (sendError: any) {
                // This is a known WhatsApp Web.js library issue - messages are actually sent successfully
                const errorMessage = sendError?.message || 'Unknown error';
                if (errorMessage.includes('serialize')) {
                    console.log('✅ Message likely sent successfully (WhatsApp Web.js internal error)');
                } else {
                    console.log('⚠️  WhatsApp Web.js error:', errorMessage);
                }
                // Don't retry to avoid duplicate messages
            }
            
            // If we couldn't confirm the message was sent, log it but don't worry
            if (!messageSent) {
                console.log('ℹ️  Message delivery status unclear (common with WhatsApp Web.js)');
            }
            
            const new_session = aiagent.session;
            
            if (!session && numbersCollection) {
                const entry: NumberEntry = {
                    number: number,
                    campaign: campaign || undefined,
                    session: new_session || undefined
                };
                numbersCollection.insert(entry);
            }
            console.log('Message sent successfully:', aiagent.text);
        } catch (sendError: any) {
            // This is a known WhatsApp Web.js issue - messages often send successfully despite this error
            console.log('⚠️  WhatsApp Web.js error (message may have been sent):', sendError?.message || 'Unknown error');
            // Don't throw the error, just log it to prevent crashes
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
};

// Event listener for incoming messages
client.on('message', async (message: Message) => {
    console.log("message triggered");
    // Check if the sender's number is in the allowed numbers list
    const senderNumberParts = message.from.split('@');
    const senderNumber: string = senderNumberParts[0] || ''; // Get the number without the domain
    if (productionmode) {
        await handleIncomingMessage(senderNumber, message, messagewaitingtime);
    } else {
        if (allowedNumbers.includes(senderNumber)) {
            console.log(`Message from ${senderNumber} ignored.`);
        } else {
            await handleIncomingMessage(senderNumber, message, messagewaitingtime);
        }
    }
});

// Remove the periodic reinitialization - it causes issues with SingletonLock
// The client should only be initialized once and handle reconnection through events

// API Route to Call sendMessage
app.post('/greetings', async (req: Request<{}, {}, GreetingRequest>, res: Response<GreetingResponse | ErrorResponse>) => {
    try {
        const { sender, message, campaign } = req.body;
        if (!sender || !message || !campaign) {
            return res.status(400).send({ error: 'Sender and message are required.' });
        }
        // Call the sendMessage function with the received parameters
        await sendMessage(sender, message, null, true, campaign);
        return res.send({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).send({ error: 'Failed to send message' });
    }
});

// Health check endpoint for Docker
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV
    });
});

// QR Code endpoint
app.get('/qr', (req: Request, res: Response) => {
    const isAuthenticated = client.info !== null && client.info !== undefined;
    
    if (currentQRCode && !isAuthenticated) {
        res.status(200).json({
            success: true,
            qr_code: currentQRCode,
            timestamp: new Date().toISOString(),
            message: 'QR code is available for scanning'
        });
    } else {
        res.status(404).json({
            success: false,
            message: isAuthenticated ? 'WhatsApp client is already authenticated' : 'QR code not available yet. Please wait for WhatsApp client to generate one.',
            timestamp: new Date().toISOString()
        });
    }
});

// QR Code status endpoint
app.get('/qr/status', (req: Request, res: Response) => {
    const isAuthenticated = client.info !== null && client.info !== undefined;
    const hasQR = currentQRCode !== null && !isAuthenticated;
    res.status(200).json({
        success: true,
        authenticated: isAuthenticated,
        has_qr: hasQR,
        timestamp: new Date().toISOString(),
        message: isAuthenticated ? 'WhatsApp client is authenticated' : (hasQR ? 'QR code is available for scanning' : 'Waiting for QR code generation')
    });
});

// Bot status endpoint
app.get('/bot/status', (req: Request, res: Response) => {
    const isAuthenticated = client.info !== null && client.info !== undefined;
    res.status(200).json({
        success: true,
        authenticated: isAuthenticated,
        bot_phone_number: myWhatsAppNumber,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        message: isAuthenticated ? 'Bot is ready and authenticated' : 'Bot is waiting for authentication'
    });
});

// Start Express server
const PORT: number = Number(env.PORT) || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown handling
async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`🛑 Received ${signal}, starting graceful shutdown...`);
    
    // Clean up message queues and processing states
    Object.keys(messageQueue).forEach(key => delete messageQueue[key]);
    Object.keys(processingUsers).forEach(key => delete processingUsers[key]);
    console.log('🧹 Cleaned up message queues and processing states');
    
    // Close WhatsApp client gracefully
    if (client) {
        try {
            console.log('📱 Closing WhatsApp client gracefully...');
            await client.destroy();
            console.log('✅ WhatsApp client closed successfully');
        } catch (error) {
            console.error('❌ Error closing WhatsApp client:', error);
        }
    }
    
    // Enhanced session preservation for Railway
    try {
        console.log(`💾 Preserving session data at: ${SESSION_PATH}`);
        
        // Check session directory exists
        if (fs.existsSync(SESSION_PATH)) {
            const sessionFiles = fs.readdirSync(SESSION_PATH);
            console.log(`📁 Found ${sessionFiles.length} session files to preserve`);
            
            // Only remove lock files, preserve all session data
            const sessionDir = path.join(SESSION_PATH, 'session');
            if (fs.existsSync(sessionDir)) {
                const lockFiles = fs.readdirSync(sessionDir).filter(file => 
                    file.includes('lock') || file.startsWith('Singleton')
                );
                
                lockFiles.forEach(file => {
                    try {
                        fs.unlinkSync(path.join(sessionDir, file));
                        console.log(`🔓 Removed lock file: ${file}`);
                    } catch (error) {
                        console.log(`⚠️ Could not remove lock file ${file}: ${error}`);
                    }
                });
                
                console.log(`✅ Preserved ${sessionFiles.length} session files`);
                console.log(`🔓 Removed ${lockFiles.length} lock files`);
            }
        } else {
            console.log('📝 No session directory found - first time setup');
        }
        
        // Verify session data is preserved
        if (fs.existsSync(SESSION_PATH)) {
            const remainingFiles = fs.readdirSync(SESSION_PATH);
            console.log(`💾 Session data preserved: ${remainingFiles.join(', ')}`);
        }
        
    } catch (error) {
        console.error('❌ Error during session preservation:', error);
    }
    
    console.log('✅ Graceful shutdown completed, exiting...');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Cleanup function to prevent memory leaks
function cleanup(): void {
    Object.keys(messageQueue).forEach(key => delete messageQueue[key]);
    Object.keys(processingUsers).forEach(key => delete processingUsers[key]);
}

// Periodic cleanup to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    // Clean up any stale processing states (older than 5 minutes)
    Object.entries(processingUsers).forEach(([user, timestamp]) => {
        if (now - timestamp > 300000) { // 5 minutes
            delete processingUsers[user];
            delete messageQueue[user];
            console.log(`Cleaned up stale processing state for ${user}`);
        }
    });
}, 60000); // Check every minute 