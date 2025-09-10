import express, { Request, Response } from 'express';
import { Client, LocalAuth, NoAuth, Message, Chat, MessageMedia } from 'whatsapp-web.js';
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
const RAILWAY_VOLUME_PATH = process.env.RAILWAY_VOLUME_PATH || "/data";
const SESSION_PATH = process.env.NODE_ENV === 'production'
  ? path.join(RAILWAY_VOLUME_PATH, '.wwebjs_auth')
  : './.wwebjs_auth';
const clientIdProd = 'whatsapp-bot-railway';
const clientIdDev = 'whatsapp-bot-dev';
const resolvedClientId = process.env.NODE_ENV === 'production' ? clientIdProd : clientIdDev;
const legacyLockFile = path.join(SESSION_PATH, 'session', 'SingletonLock');
const clientLockFile = path.join(SESSION_PATH, `session-${resolvedClientId}`, 'SingletonLock');

// Enhanced session directory management for Railway persistence
const ensureSessionDirectory = () => {
    try {
        // For Railway, we need to handle permissions more carefully
        if (process.env.NODE_ENV === 'production') {
            console.log(`💾 Railway production mode - using persistent volume at: ${SESSION_PATH}`);
            console.log(`📝 Sessions will be preserved across restarts!`);
            
            // Let WhatsApp Web.js handle directory creation to avoid permission issues
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
        console.log(`🔒 Lock file locations: ${legacyLockFile} and ${clientLockFile}`);
        
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

    // Remove any stale SingletonLock files (legacy and client-specific)
    const lockFilesToCheck = [legacyLockFile, clientLockFile];
    for (const lf of lockFilesToCheck) {
        try {
            if (!isRunning && fs.existsSync(lf)) {
                console.log(`🔓 Removing existing SingletonLock file: ${lf}`);
                fs.unlinkSync(lf);
                console.log("✅ SingletonLock removed successfully");
            }
        } catch (e) {
            console.log(`⚠️ Could not remove lock file ${lf}: ${e}`);
        }
    }
} catch (error) {
    console.error("❌ Error checking Chromium process:", error);
}

const productionmode: boolean = env.NODE_ENV === 'production';
console.log(`🌍 Environment: NODE_ENV=${env.NODE_ENV}, Production mode: ${productionmode}`);
console.log(`🌍 FW_ENDPOINT: ${env.FW_ENDPOINT}`);
console.log(`🌍 JWT_SECRET: ${env.JWT_SECRET ? 'SET' : 'NOT SET'}`);

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

const messagewaitingtime: number = 10000;

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
        let url = env.FW_ENDPOINT || 'http://localhost:3000/api/agents/herbakofAssistanceAgent/generate';
        // Ensure URL has protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
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
async function handleIncomingMessage(sender: string, message: Message, delay: number = 10000): Promise<void> {
    console.log(`🔄 handleIncomingMessage called for ${sender} with delay ${delay}ms`);
    const senderNumber: string = sender;
    
    // Check if this exact message was already processed recently
    const messageId = message.id._serialized;
    const recentProcessed = processingUsers[`${senderNumber}_${messageId}`];
    if (recentProcessed && (Date.now() - recentProcessed) < 5000) { // 5 second deduplication
        console.log(`Message ${messageId} from ${senderNumber} already processed recently, skipping`);
        return;
    }
    
    // Initialize message processing state for this user
    if (!messageQueue[senderNumber]) {
        messageQueue[senderNumber] = [];
    }
    
    // Add current message to queue
    messageQueue[senderNumber].push({
        message,
        timestamp: Date.now()
    });
    
    // Prepare chat for pre-reply actions
    let preReplyChat: Chat | null = null;
    try {
        preReplyChat = await message.getChat();
    } catch (e) {
        console.log('Could not prepare chat for pre-reply actions');
    }
    
    // Function to process all queued messages
    const processQueuedMessages = async () => {
        try {
            // Get all queued messages for this user
            const queuedMessages = messageQueue[senderNumber] || [];
            
            if (queuedMessages.length > 0) {
                // Get the chat reference
                const chatRef: Chat = preReplyChat || await message.getChat();
                
                // Combine all queued messages into one string
                const combinedUserMessages = queuedMessages
                    .map(item => item.message.body)
                    .join('\n');
                
                // If we have user messages to process
                if (combinedUserMessages && combinedUserMessages.trim()) {
                    console.log(`🔄 FINAL PROCESSING: ${queuedMessages.length} messages from ${senderNumber} after timer expired`);
                    console.log(`📝 Combined messages: "${combinedUserMessages}"`);
                    await sendMessage(senderNumber, combinedUserMessages, null, false, null);
                } else {
                    console.log(`No valid messages to process for ${senderNumber}`);
                }
            }
        } catch (error) {
            console.error(`Error processing messages for ${senderNumber}:`, error);
        } finally {
            // Mark all processed messages as processed to prevent duplicates BEFORE cleanup
            const queuedMessages = messageQueue[senderNumber] || [];
            queuedMessages.forEach(item => {
                const messageId = item.message.id._serialized;
                processingUsers[`${senderNumber}_${messageId}`] = Date.now();
            });
            
            // Clean up
            delete messageQueue[senderNumber];
            delete processingUsers[senderNumber];
            delete (processingUsers as any)[`${senderNumber}_timer`];
            delete (processingUsers as any)[`${senderNumber}_readTypingTimer`];
            console.log(`🧹 Cleaned up processing state for ${senderNumber}`);
        }
    };
    
    // Function to schedule read and typing indicators
    const scheduleReadAndTyping = (chat: Chat, delayMs: number) => {
        // Clear any existing read/typing timer
        if ((processingUsers as any)[`${senderNumber}_readTypingTimer`]) {
            clearTimeout((processingUsers as any)[`${senderNumber}_readTypingTimer`]);
        }
        
        // Schedule read and typing at a random moment within the delay window
        const minPreDelay = Math.max(0, Math.floor(delayMs * 0.3));
        const maxPreDelay = Math.max(minPreDelay, Math.floor(delayMs * 0.8));
        const preDelayMs = minPreDelay + Math.floor(Math.random() * (maxPreDelay - minPreDelay + 1));
        
        const readTypingTimer = setTimeout(async () => {
            try {
                await chat.sendSeen();
                await chat.sendStateTyping();
            } catch {
                // ignore
            }
        }, preDelayMs);
        
        (processingUsers as any)[`${senderNumber}_readTypingTimer`] = readTypingTimer;
    };
    
    // If user is already being processed, reset the timer to 10 seconds
    if (processingUsers[senderNumber]) {
        console.log(`⏰ Message from ${senderNumber} queued. Total queued: ${messageQueue[senderNumber].length}`);
        console.log(`🔄 Resetting timer to ${delay}ms for ${senderNumber}`);
        
        // Clear the existing timer and set a new one for 10 seconds
        if ((processingUsers as any)[`${senderNumber}_timer`]) {
            clearTimeout((processingUsers as any)[`${senderNumber}_timer`]);
            console.log(`⏰ Cleared previous timer for ${senderNumber}`);
        }
        
        // Reschedule read and typing indicators for the new delay
        if (preReplyChat) {
            scheduleReadAndTyping(preReplyChat, delay);
        }
        
        // Set new timer for 10 seconds (not extending, but resetting)
        const newTimer = setTimeout(async () => {
            console.log(`⏰ Timer expired for ${senderNumber}, processing queued messages...`);
            await processQueuedMessages();
        }, delay);
        
        (processingUsers as any)[`${senderNumber}_timer`] = newTimer;
        console.log(`⏰ New timer set for ${senderNumber} (${delay}ms)`);
        return;
    }
    
    // Mark user as being processed with timestamp
    processingUsers[senderNumber] = Date.now();
    console.log(`🚀 Starting initial processing for ${senderNumber}`);
    
    // Schedule read and typing indicators for the initial delay
    if (preReplyChat) {
        scheduleReadAndTyping(preReplyChat, delay);
    }
    
    // Set initial timer for 10 seconds
    const timer = setTimeout(async () => {
        console.log(`⏰ Initial timer expired for ${senderNumber}, processing queued messages...`);
        await processQueuedMessages();
    }, delay);
    
    // Store the timer reference
    (processingUsers as any)[`${senderNumber}_timer`] = timer;
    console.log(`⏰ Initial timer set for ${senderNumber} (${delay}ms)`);
}

// Function to fetch the last 10 messages after the latest reply and reply after a delay
async function replyToNewMessages(sender: string, message: Message, delay: number = 10000): Promise<void> {
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

// Convert generic LLM Markdown/HTML to WhatsApp-friendly formatting
function convertLLMToWhatsApp(content: string, preserveStructure: boolean = true): string {
    try {
        const originalLength = content.length;
        let formattedContent = content.replace(/\r\n/g, '\n');

        // Tokenize code regions to avoid accidental formatting inside code
        const codeBlocks: string[] = [];
        const inlineCodes: string[] = [];
        formattedContent = formattedContent.replace(/```([\s\S]*?)```/g, (_m, p1) => {
            const token = `__CODEBLOCK_${codeBlocks.length}__`;
            codeBlocks.push(String(p1));
            return token;
        });
        formattedContent = formattedContent.replace(/`([^`\n]+)`/g, (_m, p1) => {
            const token = `__INLINECODE_${inlineCodes.length}__`;
            inlineCodes.push(String(p1));
            return token;
        });

        // Markdown links → plain text with URL to ensure clickability in WhatsApp
        formattedContent = formattedContent.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

        // Unescape already-escaped formatting sequences
        formattedContent = formattedContent
            .replace(/\\\\_([^_]+)\\\\_/g, '_$1_')
            .replace(/\\\\\*([^*]+)\\\\\*/g, '*$1*')
            .replace(/\\\\~([^~]+)\\\\~/g, '~$1~')
            .replace(/\\\\`([^`]+)\\\\`/g, '```$1```');

        // Bullets: •, -, * at line-start → '* '
        // Protect bullet markers using a neutral sentinel that won't collide with formatting rules
        formattedContent = formattedContent
            .replace(/^[\t ]*[•]\s+/gm, '§BULLET§ ')
            .replace(/^[\t ]*[-*]\s+/gm, '§BULLET§ ');

        // Numbered lists: 1) → 1.
        formattedContent = formattedContent
            .replace(/^[\t ]*(\d+)\)\s+/gm, '$1. ')
            .replace(/^[\t ]*(\d+)\.\s+/gm, '$1. ');

        // Bold: **text** or __text__ → *text*
        formattedContent = formattedContent
            .replace(/\*\*(.+?)\*\*/g, '*$1*')
            .replace(/__(.+?)__/g, '*$1*')
            .replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*')
            .replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*');

        // Italic: single-asterisk or underscores → _text_
        // - Do not convert list bullets '* ' (handled via sentinel)
        // - Do not convert bold '**...**' (handled above)
        // - Avoid snake_case by requiring non-word boundaries
        formattedContent = formattedContent
            .replace(/(^|[^\w*])\*(?!\*)([^\s*][^*]*?[^\s*])\*(?!\*)/g, '$1_$2_')
            .replace(/(^|[^\w])_(?!_)([^_\n]+?)_(?=[^\w]|$)/g, '$1_$2_')
            .replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_')
            .replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_');

        // Strikethrough: ~~text~~ or <s>/<strike> → ~text~
        formattedContent = formattedContent
            .replace(/~~([\s\S]*?)~~/g, '~$1~')
            .replace(/<s>([\s\S]*?)<\/s>/gi, '~$1~')
            .replace(/<strike>([\s\S]*?)<\/strike>/gi, '~$1~');

        // Headers (# ...) → *...*
        formattedContent = formattedContent.replace(/^[\t ]*#{1,6}[\t ]+(.+)$/gm, '*$1*');

        // Blockquotes (> ...) and <blockquote>
        formattedContent = formattedContent
            .replace(/^[\t ]*>[\t ]+/gm, '> ')
            .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_m, p1) => String(p1).replace(/^/gm, '> '));

        // Basic HTML → text
        formattedContent = formattedContent
            .replace(/<br\s*\/?>(\n)?/gi, '\n')
            .replace(/<\/(p|div)>\s*<\1>/gi, '\n\n')
            .replace(/<\/(h\d)>\s*/gi, '\n\n')
            .replace(/<\/?(p|div|span)>/gi, '')
            .replace(/<[^>]+>/g, '');

        // Restore bullet sentinel to WhatsApp bullet style
        formattedContent = formattedContent.replace(/^§BULLET§ /gm, '* ');

        if (!preserveStructure) {
            formattedContent = formattedContent
                .replace(/\n{3,}/g, '\n\n')
                .replace(/[ ]{2,}/g, ' ');
        }

        // Restore code placeholders
        formattedContent = formattedContent.replace(/__INLINECODE_(\d+)__/g, (_m, i) => '`' + (inlineCodes[Number(i)] ?? '') + '`');
        formattedContent = formattedContent.replace(/__CODEBLOCK_(\d+)__/g, (_m, i) => '```' + (codeBlocks[Number(i)] ?? '') + '```');

        console.log('✅ WhatsApp formatting completed', {
            originalLength,
            formattedLength: formattedContent.length,
            reduction: originalLength - formattedContent.length
        });
        return formattedContent;
    } catch (error) {
        console.log('⚠️ Error in WhatsApp formatting, sending original content', error);
        return content;
    }
}

// Only set executablePath if BROWSER_PATH is defined
if (BROWSER_PATH) {
    // We'll set this in the client configuration below
}

const client: Client = new Client({
    authStrategy: new LocalAuth({
        // Persist session inside Railway volume; see docs: https://wwebjs.dev/guide/creating-your-bot/authentication.html#location-path
        dataPath: SESSION_PATH,
        clientId: resolvedClientId
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
            // Allow LocalAuth to manage the Chromium user data dir for session persistence
        ],
        timeout: 120000,
        defaultViewport: null
    }
});

console.log(`🚀 Initializing WhatsApp client with session path: ${SESSION_PATH}`);
console.log(`🔒 Using LocalAuth strategy for session persistence`);

// Initialize the client (following the docs pattern)
client.initialize();

// Add a timeout to check if client is ready after 30 seconds
setTimeout(async () => {
    console.log('⏰ 30-second timeout check - checking client state...');
    console.log('⏰ Client info:', client.info);
    
    let state: string | null = null;
    try {
        state = await client.getState();
        console.log('⏰ Client state:', state);
    } catch (error) {
        console.log('⏰ Error getting client state:', error);
    }
    
    if (client.info && !myWhatsAppNumber) {
        console.log('⏰ Client appears ready but ready event didn\'t fire - manually setting up...');
        myWhatsAppNumber = client.info.wid._serialized;
        console.log("📞 Bot phone number (manual):", myWhatsAppNumber);
        
        // Client is ready - no need to test
        console.log('🧪 Client is ready and phone number is set');
    } else if (state === 'CONNECTED' && !client.info) {
        console.log('⏰ Client is CONNECTED but info is undefined - trying aggressive info loading...');
        
        // Just wait for client.info to populate naturally
        console.log('🔄 Waiting for client.info to load naturally...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        if (client.info && (client.info as any).wid) {
            myWhatsAppNumber = (client.info as any).wid._serialized;
            console.log("📞 Bot phone number (loaded after long wait):", myWhatsAppNumber);
        } else {
            console.log('🔄 Still no client.info after long wait');
        }
        
        // If still no info, try reinitialize
        if (!client.info) {
            console.log('🔄 Still no client.info after aggressive loading - attempting reinitialize...');
            try {
                await client.destroy();
                console.log('🔄 Client destroyed, reinitializing...');
                setTimeout(() => {
                    client.initialize();
                    console.log('🔄 Client reinitialized');
                }, 2000);
            } catch (error) {
                console.log('🔄 Error during force reinitialize:', error);
            }
        }
    } else {
        console.log('⏰ Client not ready - info:', client.info, 'myWhatsAppNumber:', myWhatsAppNumber);
        
        // If client is still not ready after 30 seconds, try to force reinitialize
        console.log('🔄 Attempting to force client reinitialize...');
        try {
            await client.destroy();
            console.log('🔄 Client destroyed, reinitializing...');
            setTimeout(() => {
                client.initialize();
                console.log('🔄 Client reinitialized');
            }, 2000);
        } catch (error) {
            console.log('🔄 Error during force reinitialize:', error);
        }
    }
}, 30000);

// Generate and display QR code
client.on('qr', (qr: string) => {
    console.log('🔐 QR Code generated! Scan this with WhatsApp:');
    // Generate and print the QR code in the terminal
    qrcode.generate(qr, { small: true });
    console.log('📱 Open WhatsApp on your phone and scan the QR code above');
    currentQRCode = qr; // Store QR code in global variable
});

client.once('ready', async () => {
    console.log('✅ WhatsApp client is ready!');
    console.log('🤖 Bot is now active and listening for messages');
    console.log(`💾 Session data persisted at: ${SESSION_PATH}`);

    // Clear QR code since client is now authenticated
    currentQRCode = null;

    // Get the current user's information
    console.log('🔍 Checking client.info:', client.info);
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
    } else {
        console.log('❌ client.info is null or undefined');
    }
    
    // Test if client is working by checking if we can get chats
    try {
        console.log('🧪 Testing client functionality...');
        const chats = await client.getChats();
        console.log(`🧪 Client test successful - found ${chats.length} chats`);
    } catch (error) {
        console.log('🧪 Client test failed:', error);
    }
});

client.on('authenticated', () => {
    console.log('✅ Successfully authenticated with WhatsApp!');
    console.log(`💾 Authentication data saved to: ${SESSION_PATH}`);
    // Clear QR code since client is now authenticated
    currentQRCode = null;
    
    // Check client state after authentication
    client.getState().then(state => {
        console.log('🔍 Client state after authentication:', state);
    }).catch(err => {
        console.log('🔍 Error getting client state:', err);
    });
    console.log('🔍 Client info after authentication:', client.info);
    
    // Force wait for client to be ready
    setTimeout(async () => {
        console.log('🔄 Checking client readiness after authentication...');
        try {
            const state = await client.getState();
            console.log('🔄 Client state after 5s:', state);
            
            if (state === 'CONNECTED' && !myWhatsAppNumber) {
                console.log('🔄 Client is connected but info not loaded - attempting to force load...');
                
                // Just wait for client.info to populate naturally
                console.log('🔄 Waiting for client.info to load naturally...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                if (client.info && (client.info as any).wid) {
                    myWhatsAppNumber = (client.info as any).wid._serialized;
                    console.log("📞 Bot phone number (loaded after wait):", myWhatsAppNumber);
                } else {
                    console.log('🔄 Still no client.info after waiting - will try again later');
                }
            }
        } catch (error) {
            console.log('🔄 Error checking client readiness:', error);
        }
    }, 5000);
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
    console.log(`📤 sendMessage called for ${number} with message: "${message}"`);
    console.log(`📤 Initial: ${initial}, Campaign: ${campaign}`);
    
    try {
        // Find the entry by the number field
        const numberEntry: NumberEntry | null = numbersCollection?.findOne({ number }) || null;

        let session: string | null = null;
        console.log("📤 numberEntry", numberEntry);
        console.log("📤 initial", initial);
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
        console.log(`🤖 Calling AI API with message: "${message}"`);
        aiagent = await callInferenceFw(message, session || undefined, number, userName);
        console.log(`🤖 AI Response received:`, aiagent);
        
        // Validate that we have a valid response text
        if (!aiagent || !aiagent.text) {
            console.error('❌ Invalid AI response:', aiagent);
            return;
        }
        
        try {
                    // Check if client is ready and authenticated
        if (!client.info) {
            console.error('WhatsApp client not authenticated');
            return;
        }
        
        // Additional check for client state
        if (!client.pupPage || client.pupPage.isClosed()) {
            console.error('WhatsApp client page not ready');
            return;
        }
            
            // Validate the phone number format
            if (!formattedNumber || !formattedNumber.includes('@')) {
                console.error('Invalid phone number format:', formattedNumber);
                return;
            }
            
            // Extract explicit Markdown images first: ![alt](url)
            const imageMdRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s]+)\)/g;
            const extractedMediaList: { url: string; caption?: string | undefined }[] = [];
            const withMediaTokens = (aiagent.text || '').replace(imageMdRegex, (_m: string, alt: string, url: string) => {
                const idx = extractedMediaList.length;
                    const cap = String(alt || '').trim();
                    extractedMediaList.push({ url: String(url), caption: cap.length > 0 ? cap : undefined });
                return `[[MEDIA_${idx}]]`;
            });

            // Normalize and convert LLM markdown to WhatsApp formatting before splitting
            const normalizedText = convertLLMToWhatsApp(withMediaTokens, true);
            // Split by double newlines as logical blocks
            const rawBlocks = normalizedText.split('\n\n').map(b => b.trim()).filter(Boolean);

            // Within each block, extract media URLs prefixed by '@' and schedule sends in-order
            // Only treat as media if URL ends with a known media extension (images/videos/audio), optional query/hash
            // Examples: @https://example.com/file.png, @https://cdn/x.mp4?token=abc
            const mediaExtPattern = '(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv|mp3|wav|ogg|m4a|aac)';
            const urlRegex = new RegExp('@\\s*(https?:\\/\\/[^\\s]+?\\.(?:' + mediaExtPattern + ')(?:[?#][^\\s]*)?)', 'gi');

            type OutgoingPart = { kind: 'text' | 'media'; value: string; caption?: string | undefined };
            const outgoingParts: OutgoingPart[] = [];

            for (const block of rawBlocks) {
                // Build a combined scanner to extract, in order:
                // 1) explicit markdown image tokens __MEDIA_n__
                // 2) @explicit media URLs by extension
                // 3) bare media URLs by extension
                const mediaExtPattern = '(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv|mp3|wav|ogg|m4a|aac)';
                const combined = new RegExp(
                    `(__MEDIA_(\\d+)__|\\[\\[MEDIA_(\\d+)\\]\\])|@\\s*(https?:\\/\\/[^\\s]+\\.(?:${mediaExtPattern})(?:[?#][^\\s]*)?)|(https?:\\/\\/[^\\s]+\\.(?:${mediaExtPattern})(?:[?#][^\\s]*)?)`,
                    'gi'
                );
                let lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = combined.exec(block)) !== null) {
                    const pre = block.slice(lastIndex, m.index).trim();
                    if (pre) outgoingParts.push({ kind: 'text', value: pre });

                    if (m[1]) {
                        // media token: either __MEDIA_n__ or [[MEDIA_n]]
                        const idx = Number(m[2] ?? m[3] ?? -1);
                        const meta = extractedMediaList[idx];
                        if (meta && meta.url) {
                            outgoingParts.push({ kind: 'media', value: meta.url, caption: meta.caption });
                        } else {
                            // Fallback: keep the token textually if something went wrong
                            outgoingParts.push({ kind: 'text', value: m[0] });
                        }
                    } else {
                        // Either @media url (group 3) or bare media url (group 4)
                        const url = (m[4] || m[5]) ?? '';
                        if (url) outgoingParts.push({ kind: 'media', value: url });
                    }

                    lastIndex = m.index + m[0].length;
                }
                const tail = block.slice(lastIndex).trim();
                if (tail) outgoingParts.push({ kind: 'text', value: tail });
            }

            console.log(`📝 Prepared ${outgoingParts.length} outgoing part(s) for ${formattedNumber}`);

            for (let i = 0; i < outgoingParts.length; i++) {
                const part = outgoingParts[i];
                if (!part) continue;
                try {
                    const chat = await client.getChatById(formattedNumber);
                    await chat.sendStateTyping();
                } catch {}

                if (part.kind === 'media') {
                    try {
                        const mediaUrl = String(part.value);
                        const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                        try {
                            if (part.caption) {
                                await client.sendMessage(formattedNumber, media, { caption: part.caption });
                            } else {
                                await client.sendMessage(formattedNumber, media);
                            }
                            console.log(`🖼️ Sent media from ${mediaUrl}`);
                        } catch (sendErr: any) {
                            const errorMessage = (sendErr?.message || '').toString();
                            if (errorMessage.includes('serialize')) {
                                console.log('✅ Media likely sent successfully (WhatsApp Web.js internal error)');
                                // Do not send URL fallback to avoid duplicates
                            } else {
                                console.log('⚠️ WhatsApp Web.js error sending media:', errorMessage);
                                // Fallback: send URL as text only for real failures
                                await client.sendMessage(formattedNumber, part.value);
                            }
                        }
                    } catch (mediaErr: any) {
                        console.log(`⚠️ Failed to fetch media ${String(part.value)}:`, mediaErr?.message || mediaErr);
                        // Fallback: send URL as text if fetching media fails
                        await client.sendMessage(formattedNumber, part.value);
                    }
                } else {
                    // text
                    try {
                        await client.sendMessage(formattedNumber, part.value);
                        console.log(`✅ Sent text part`);
                    } catch (textErr: any) {
                        const errorMessage = textErr?.message || 'Unknown error';
                        if (errorMessage.includes('serialize')) {
                            console.log('✅ Text likely sent successfully (WhatsApp Web.js internal error)');
                        } else {
                            console.log('⚠️ WhatsApp Web.js error for text part:', errorMessage);
                        }
                    }
                }

                // Natural delay between parts
                if (i < outgoingParts.length - 1) {
                    const delayMs = 1000 + Math.floor(Math.random() * 2000);
                    console.log(`⏳ Waiting ${delayMs}ms before next part`);
                    try {
                        const chat = await client.getChatById(formattedNumber);
                        await chat.sendStateTyping();
                    } catch {}
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
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
console.log("📨 Registering message event handler...");
client.on('message_create', async (message: Message) => {
    console.log("📨 Message triggered from:", message.from);
    console.log("📨 Message body:", message.body);
    console.log("📨 Production mode:", productionmode);
    
    // Check if the sender's number is in the allowed numbers list
    const senderNumberParts = message.from.split('@');
    const senderNumber: string = senderNumberParts[0] || ''; // Get the number without the domain
    
    console.log("📨 Sender number:", senderNumber);
    console.log("📨 Allowed numbers:", allowedNumbers);
    
    if (productionmode) {
        console.log("📨 Processing message in production mode");
        await handleIncomingMessage(senderNumber, message, messagewaitingtime);
    } else {
        if (allowedNumbers.includes(senderNumber)) {
            console.log(`📨 Message from ${senderNumber} ignored (whitelisted).`);
        } else {
            console.log("📨 Processing message in development mode");
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

// Disconnect WhatsApp session endpoint
app.post('/bot/disconnect', async (req: Request, res: Response) => {
    try {
        const isAuthenticated = client.info !== null && client.info !== undefined;
        
        if (!isAuthenticated) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp client is not authenticated',
                timestamp: new Date().toISOString()
            });
        }

        console.log('🔄 Disconnecting WhatsApp client...');
        
        // Destroy the client
        await client.destroy();
        
        // Clear session data
        try {
            if (fs.existsSync(SESSION_PATH)) {
                const sessionFiles = fs.readdirSync(SESSION_PATH);
                sessionFiles.forEach(file => {
                    const filePath = path.join(SESSION_PATH, file);
                    if (fs.statSync(filePath).isDirectory()) {
                        fs.rmSync(filePath, { recursive: true, force: true });
                    } else {
                        fs.unlinkSync(filePath);
                    }
                });
                console.log('🧹 Session data cleared');
            }
        } catch (error) {
            console.log('⚠️ Could not clear session data:', error);
        }

        // Reset global variables
        myWhatsAppNumber = null;
        currentQRCode = null;
        
        // Force clear client info to ensure QR code is available
        (client as any).info = null;

        console.log('✅ WhatsApp client disconnected successfully');
        
        return res.status(200).json({
            success: true,
            message: 'WhatsApp client disconnected successfully. You will need to scan QR code again to reconnect.',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error disconnecting WhatsApp client:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to disconnect WhatsApp client',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
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

// Test endpoint
app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({ message: 'Test endpoint working' });
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