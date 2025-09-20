import express, { Request, Response } from 'express';
import { Client, Message, Chat, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import Loki from 'lokijs';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { WhatsAppClientManager, ClientInfo } from './client-manager';

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

// MongoDB RemoteAuth - no persistent file storage needed
const clientIdProd = 'whatsapp-bot-railway';
const clientIdDev = 'whatsapp-bot-dev';
const resolvedClientId = process.env.NODE_ENV === 'production' ? clientIdProd : clientIdDev;



try {
    // Check if Chromium is already running
    const isRunning = execSync("pgrep -x chromium || pgrep -x chromium-browser || echo 0")
        .toString().trim() !== "0";

    // MongoDB RemoteAuth handles session management - no lock files to manage
} catch (error) {
    console.error("❌ Error checking Chromium process:", error);
}

const productionmode: boolean = env.NODE_ENV === 'production';
console.log(`🌍 Environment: NODE_ENV=${env.NODE_ENV}, Production mode: ${productionmode}`);
console.log(`🌍 FW_ENDPOINT: ${env.FW_ENDPOINT}`);
console.log(`🌍 JWT_SECRET: ${env.JWT_SECRET ? 'SET' : 'NOT SET'}`);

// Client manager will be initialized after BROWSER_PATH is defined

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

// Ensure Puppeteer Path is Correct - try multiple paths
const BROWSER_PATH: string | undefined = env.CHROMIUM_PATH || (() => {
    if (process.platform === 'darwin') {
        return '/opt/homebrew/bin/chromium';
    } else {
        // Try multiple Chromium paths in order of preference
        const possiblePaths = [
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/opt/google/chrome/chrome'
        ];
        
        // Check which path exists
        for (const path of possiblePaths) {
            try {
                if (fs.existsSync(path)) {
                    console.log(`🔍 Found Chromium at: ${path}`);
                    return path;
                }
            } catch (error) {
                // Continue to next path
            }
        }
        
        console.log('⚠️ No Chromium found in standard paths, using default');
        return '/usr/bin/chromium-browser';
    }
})();

// Validate MongoDB URI is provided
if (!env.MONGODB_URI) {
    console.error('❌ MONGODB_URI environment variable is required');
    process.exit(1);
}

// Initialize WhatsApp Client Manager
const clientManager = new WhatsAppClientManager({
    chromiumPath: BROWSER_PATH || '/usr/bin/chromium-browser',
    mongoUri: env.MONGODB_URI,
    backupSyncIntervalMs: 300000, // 5 minutes backup interval
    maxRetries: 5, // Maximum retry attempts for client initialization
    retryDelayMs: 2000, // Base delay between retries (exponential backoff)
    healthCheckIntervalMs: 30000, // Health check every 30 seconds
    puppeteerArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--disable-features=Translate,BackForwardCache',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--force-color-profile=srgb',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain',
        '--remote-debugging-port=0',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    ]
});

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
        console.log('🤖 Using AI endpoint URL:', url);
        console.log('🤖 Environment variables:', {
            FW_ENDPOINT: env.FW_ENDPOINT || 'NOT SET',
            JWT_SECRET: env.JWT_SECRET ? 'SET' : 'NOT SET'
        });
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

        console.log('🤖 AI API Response Status:', response.status);
        console.log('🤖 AI API Response Data:', JSON.stringify(response.data, null, 2));

        const rsp = response.data;
        const jsonData: AIAgentResponse = {
            text: rsp.text || 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
            session: session || null
        };
        
        // Ensure we always have a valid text response
        if (!jsonData.text || jsonData.text.trim() === '') {
            console.error('❌ AI response has empty or invalid text:', jsonData);
            jsonData.text = 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu';
        }
        
        return jsonData;
    } catch (error) {
        console.error('❌ Error during AI inference:', error);
        if (axios.isAxiosError(error)) {
            console.error('❌ Axios Error Details:');
            console.error('  - Status:', error.response?.status);
            console.error('  - Status Text:', error.response?.statusText);
            console.error('  - Response Data:', error.response?.data);
            console.error('  - Request URL:', error.config?.url);
            console.error('  - Request Headers:', error.config?.headers);
        }
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
async function handleIncomingMessage(clientId: string, sender: string, message: Message, delay: number = 10000): Promise<void> {
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
                    await sendMessage(clientId, senderNumber, combinedUserMessages, null, false, null);
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

// All clients are created via API - no default client

// Message handler function for any client
async function handleIncomingMessageFromClient(clientId: string, message: Message): Promise<void> {
    console.log(`📨 MESSAGE RECEIVED from client ${clientId}:`, message.from);
    console.log("📨 MESSAGE BODY:", message.body);
    console.log("📨 MESSAGE TIMESTAMP:", new Date().toISOString());
    
    // Simple test - just reply to any message
    if (message.body === '!ping') {
        message.reply('pong');
        console.log("📨 Replied with pong");
    }
    
    // Check if the sender's number is in the allowed numbers list
    const senderNumberParts = message.from.split('@');
    const senderNumber: string = senderNumberParts[0] || '';
    
    console.log("📨 Sender number:", senderNumber);
    
    console.log("📨 Production mode:", productionmode);
    console.log("📨 Allowed numbers:", allowedNumbers);
    console.log("📨 Sender number:", senderNumber);
    
    if (productionmode) {
        console.log("📨 Processing message in production mode");
        await handleIncomingMessage(clientId, senderNumber, message, messagewaitingtime);
    } else {
        if (allowedNumbers.includes(senderNumber)) {
            console.log(`📨 Message from ${senderNumber} ignored (whitelisted).`);
        } else {
            console.log("📨 Processing message in development mode");
            await handleIncomingMessage(clientId, senderNumber, message, messagewaitingtime);
        }
    }
}

console.log(`🚀 Initializing WhatsApp client with MongoDB RemoteAuth`);
console.log(`🔍 Using Chromium path: ${BROWSER_PATH}`);

// Message handling is now managed by the client manager

// Initialize the client manager (MongoDB connection) only
async function initializeApp() {
    try {
        // Initialize MongoDB connection
        console.log('🔗 Initializing MongoDB connection...');
        await clientManager.initialize();
        console.log('✅ MongoDB connection established');
        
        // Register message handler
        clientManager.addMessageHandler(handleIncomingMessageFromClient);
        console.log('✅ Message handler registered');
        
        // Restore existing sessions from MongoDB
        await clientManager.restoreExistingSessions();
        
        console.log('🚀 WhatsApp Bot API ready - existing sessions restored, new clients can be created via API endpoints');
    } catch (error) {
        console.error('❌ Failed to initialize app:', error);
        process.exit(1);
    }
}

// Start the application
initializeApp();

// No automatic client creation - all clients created via API

// Event handling is now managed by the client manager


// Function to send a message via a specific client
const sendMessage = async (
    clientId: string,
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
            const response = await clientManager.sendMessage(clientId, formattedNumber, message);
            console.log('Message sent successfully:');
            return;
        } 

        if (numberEntry) {
            session = numberEntry.session || null;
        } 

        // Get user contact information
        let userName: string = 'WhatsApp User';
        try {
            const client = clientManager.getClient(clientId);
            if (client) {
                const contact = await client.client.getContactById(formattedNumber);
            if (contact && contact.pushname) {
                userName = contact.pushname;
                }
            }
        } catch (error) {
            console.log('Could not get contact info, using default name');
        }

        let aiagent: AIAgentResponse;
        console.log(`🤖 Calling AI API with message: "${message}"`);
        console.log(`🤖 AI API Parameters:`, {
            message,
            session: session || 'none',
            phoneNumber: number,
            userName,
            clientId
        });
        aiagent = await callInferenceFw(message, session || undefined, number, userName);
        console.log(`🤖 AI Response received:`, aiagent);
        
        // Validate that we have a valid response text
        if (!aiagent || !aiagent.text) {
            console.error('❌ Invalid AI response:', aiagent);
            return;
        }
        
        try {
                    // Check if client is ready and authenticated
        const client = clientManager.getClient(clientId);
        if (!client) {
            console.error('WhatsApp client not found:', clientId);
            return;
        }
        
        // Check if client is connected
        const clientState = await client.client.getState();
        if (clientState !== 'CONNECTED') {
            console.error('WhatsApp client not connected, state:', clientState);
            return;
        }
        
        // Additional check for client state
        if (!client.client.pupPage || client.client.pupPage.isClosed()) {
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
                    const chat = await client.client.getChatById(formattedNumber);
                    await chat.sendStateTyping();
                } catch {}

                if (part.kind === 'media') {
                    try {
                        const mediaUrl = String(part.value);
                        const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                        try {
                            if (part.caption) {
                                await client.client.sendMessage(formattedNumber, media, { caption: part.caption });
                    } else {
                                await client.client.sendMessage(formattedNumber, media);
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
                                await client.client.sendMessage(formattedNumber, part.value);
                            }
                        }
                    } catch (mediaErr: any) {
                        console.log(`⚠️ Failed to fetch media ${String(part.value)}:`, mediaErr?.message || mediaErr);
                        // Fallback: send URL as text if fetching media fails
                        await client.client.sendMessage(formattedNumber, part.value);
                    }
                } else {
                    // text
                    try {
                        await client.client.sendMessage(formattedNumber, part.value);
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
                        const chat = await client.client.getChatById(formattedNumber);
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

// Message event handler is now registered before client initialization above

// Remove the periodic reinitialization - it causes issues with SingletonLock
// The client should only be initialized once and handle reconnection through events

// Test endpoint to check client functionality
app.post('/test-client', async (req: Request, res: Response) => {
    try {
        console.log('🧪 Testing client functionality via API...');
        
        const clients = clientManager.getAllClients();
        if (clients.length === 0) {
            return res.json({
                success: true,
                message: 'No clients available - create clients via API first',
                clientCount: 0
            });
        }
        
        // Test the first available client
        const firstClient = clients[0];
        if (!firstClient) {
            return res.status(400).json({ error: 'No valid client found' });
        }
        
        const clientState = await firstClient.client.getState();
        console.log('🧪 Client state:', clientState);
        
        // Check if client can get chats
        const chats = await firstClient.client.getChats();
        console.log('🧪 Number of chats:', chats.length);
        
        // Check client info
        console.log('🧪 Client info:', firstClient.client.info);
        
        return res.json({
            success: true,
            clientId: firstClient.clientId,
            clientState,
            chatCount: chats.length,
            clientInfo: firstClient.client.info ? 'Available' : 'Not available',
            totalClients: clients.length
        });
    } catch (error) {
        console.error('🧪 Error testing client:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// Test endpoint to manually send a message
app.post('/test-send', async (req: Request, res: Response) => {
    try {
        const { number, message } = req.body;
        if (!number || !message) {
            return res.status(400).json({ error: 'Number and message are required' });
        }
        
        console.log('🧪 Testing manual message send...');
        console.log('🧪 To:', number);
        console.log('🧪 Message:', message);
        
        const clients = clientManager.getAllClients();
        if (clients.length === 0) {
            return res.status(400).json({ error: 'No clients available - create clients via API first' });
        }
        
        // Use the first available client
        const firstClient = clients[0];
        if (!firstClient) {
            return res.status(400).json({ error: 'No valid client found' });
        }
        
        const clientState = await firstClient.client.getState();
        console.log('🧪 Client state before send:', clientState);
        
        // Try to send message directly
        const formattedNumber = `${number}@c.us`;
        const result = await firstClient.client.sendMessage(formattedNumber, message);
        
        console.log('🧪 Message sent successfully:', result);
        
        return res.json({
            success: true,
            message: 'Test message sent successfully',
            result: result.id._serialized
        });
    } catch (error) {
        console.error('🧪 Error sending test message:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// Test endpoint to check if events are working
app.post('/test-events', async (req: Request, res: Response) => {
    try {
        console.log('🧪 Testing event system...');
        
        const clients = clientManager.getAllClients();
        if (clients.length === 0) {
            return res.json({
                success: true,
                message: 'No clients available - create clients via API first',
                clientCount: 0
            });
        }
        
        // Test the first available client
        const firstClient = clients[0];
        if (!firstClient) {
            return res.json({
                success: true,
                message: 'No valid client found',
                clientCount: 0
            });
        }
        
        const clientState = await firstClient.client.getState();
        console.log('🧪 Client state:', clientState);
        
        // Check if client can get chats
        const chats = await firstClient.client.getChats();
        console.log('🧪 Number of chats:', chats.length);
        
        // Check if client can get the current user
        console.log('🧪 Client info:', firstClient.client.info);
        
        // Check if we can get the current user's number
        if (firstClient.client.info) {
            console.log('🧪 Client info wid:', (firstClient.client.info as any).wid);
            console.log('🧪 Client info wid serialized:', (firstClient.client.info as any).wid?._serialized);
        }
        
        // Check Chromium path
        console.log('🧪 Chromium path:', BROWSER_PATH);
        
        return res.json({
            success: true,
            clientId: firstClient.clientId,
            clientState,
            chatCount: chats.length,
            clientInfo: firstClient.client.info ? 'Available' : 'Not available',
            totalClients: clients.length,
            chromiumPath: BROWSER_PATH
        });
    } catch (error) {
        console.error('🧪 Error testing events:', error);
        return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

// API Route to Call sendMessage
app.post('/greetings', async (req: Request<{}, {}, GreetingRequest>, res: Response<GreetingResponse | ErrorResponse>) => {
    try {
        const { sender, message, campaign } = req.body;
        if (!sender || !message || !campaign) {
            return res.status(400).send({ error: 'Sender and message are required.' });
        }
        // Get the first available client for backward compatibility
        const clients = clientManager.getAllClients();
        if (clients.length === 0) {
            return res.status(400).json({ error: 'No clients available - create clients via API first' });
        }
        
        const firstClient = clients[0];
        if (!firstClient) {
            return res.status(400).json({ error: 'No valid client found' });
        }
        
        // Call the sendMessage function with the received parameters
        await sendMessage(firstClient.clientId, sender, message, null, true, campaign);
        return res.send({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        return res.status(500).send({ error: 'Failed to send message' });
    }
});

// Disconnect WhatsApp session endpoint
app.post('/bot/disconnect', async (req: Request, res: Response) => {
    try {
        const clients = clientManager.getAllClients();
        if (clients.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No clients available to disconnect',
                timestamp: new Date().toISOString()
            });
        }
        
        // Disconnect the first available client for backward compatibility
        const firstClient = clients[0];
        if (!firstClient) {
            return res.status(400).json({
                success: false,
                message: 'No valid client found to disconnect',
                timestamp: new Date().toISOString()
            });
        }
        
        const isAuthenticated = firstClient.client.info !== null && firstClient.client.info !== undefined;
        
        if (!isAuthenticated) {
            return res.status(400).json({
                success: false,
                message: 'WhatsApp client is not authenticated',
                timestamp: new Date().toISOString()
            });
        }

        console.log(`🔄 Disconnecting WhatsApp client ${firstClient.clientId}...`);
        
        // Remove the client from the manager
        await clientManager.removeClient(firstClient.clientId);
        
        // Session data is managed by MongoDB RemoteAuth - no file cleanup needed

        // Reset global variables
        myWhatsAppNumber = null;
        currentQRCode = null;

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

// QR Code endpoint (legacy - use /clients/{clientId}/qr instead)
app.get('/qr', (req: Request, res: Response) => {
    const clients = clientManager.getAllClients();
    if (clients.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No clients available - create clients via API first'
        });
    }
    
    // Use the first available client for backward compatibility
    const firstClient = clients[0];
    if (!firstClient) {
        return res.status(400).json({
            success: false,
            message: 'No valid client found'
        });
    }
    
    const isAuthenticated = firstClient.client.info !== null && firstClient.client.info !== undefined;
    
    // Get QR code from the client manager
    const clientStatus = clientManager.getClientStatus(firstClient.clientId);
    if (clientStatus && clientStatus.qrCode && !isAuthenticated) {
        return res.status(200).json({
            success: true,
            qr_code: clientStatus.qrCode,
            clientId: firstClient.clientId,
            timestamp: new Date().toISOString(),
            message: 'QR code is available for scanning'
        });
    } else {
        return res.status(404).json({
            success: false,
            message: isAuthenticated ? 'WhatsApp client is already authenticated' : 'QR code not available yet. Please wait for WhatsApp client to generate one.',
            timestamp: new Date().toISOString()
        });
    }
});

// QR Code status endpoint (legacy - use /clients/{clientId} instead)
app.get('/qr/status', (req: Request, res: Response) => {
    const clients = clientManager.getAllClients();
    if (clients.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'No clients available - create clients via API first'
        });
    }
    
    // Use the first available client for backward compatibility
    const firstClient = clients[0];
    if (!firstClient) {
        return res.status(400).json({
            success: false,
            message: 'No valid client found'
        });
    }
    
    const isAuthenticated = firstClient.client.info !== null && firstClient.client.info !== undefined;
    const clientStatus = clientManager.getClientStatus(firstClient.clientId);
    const hasQR = clientStatus && clientStatus.qrCode && !isAuthenticated;
    return res.status(200).json({
        success: true,
        authenticated: isAuthenticated,
        has_qr: hasQR,
        timestamp: new Date().toISOString(),
        message: isAuthenticated ? 'WhatsApp client is authenticated' : (hasQR ? 'QR code is available for scanning' : 'Waiting for QR code generation')
    });
});

// Bot status endpoint (legacy - use /clients instead)
app.get('/bot/status', (req: Request, res: Response) => {
    const clients = clientManager.getAllClients();
    if (clients.length === 0) {
        return res.status(200).json({
            success: true,
            authenticated: false,
            message: 'No clients available - create clients via API first',
            totalClients: 0
        });
    }
    
    // Use the first available client for backward compatibility
    const firstClient = clients[0];
    if (!firstClient) {
        return res.status(200).json({
            success: true,
            authenticated: false,
            message: 'No valid client found',
            totalClients: 0
        });
    }
    
    const isAuthenticated = firstClient.client.info !== null && firstClient.client.info !== undefined;
    return res.status(200).json({
        success: true,
        authenticated: isAuthenticated,
        clientId: firstClient.clientId,
        bot_phone_number: myWhatsAppNumber,
        totalClients: clients.length,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        message: isAuthenticated ? 'Bot is ready and authenticated' : 'Bot is waiting for authentication'
    });
});

// Test endpoint
app.get('/test', (req: Request, res: Response) => {
    res.status(200).json({ message: 'Test endpoint working' });
});

// ==================== MULTI-CLIENT API ENDPOINTS ====================

// Create a new WhatsApp client
app.post('/clients', async (req: Request, res: Response) => {
    try {
        const { clientId } = req.body;
        
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId is required' 
            });
        }
        
        // Check if client already exists
        if (clientManager.getClient(clientId)) {
            return res.status(409).json({ 
                success: false, 
                error: `Client with ID '${clientId}' already exists` 
            });
        }
        
        console.log(`🚀 Creating new WhatsApp client: ${clientId}`);
        const clientInfo = await clientManager.createClient(clientId);
        
        // Initialize the client
        await clientManager.initializeClient(clientId);
        
        return res.status(201).json({
            success: true,
            message: `Client '${clientId}' created and initialized successfully`,
            clientId: clientInfo.clientId,
            status: clientInfo.status
        });
        
    } catch (error) {
        console.error('❌ Error creating client:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// List all clients
app.get('/clients', (req: Request, res: Response) => {
    try {
        const clients = clientManager.getAllClientsStatus();
        
        return res.status(200).json({
            success: true,
            clients: clients,
            total: clients.length
        });
        
        } catch (error) {
        console.error('❌ Error listing clients:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Get specific client status
app.get('/clients/:clientId', (req: Request, res: Response) => {
    try {
        const { clientId } = req.params;
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId parameter is required' 
            });
        }
        const clientStatus = clientManager.getClientStatus(clientId);
        
        if (!clientStatus) {
            return res.status(404).json({ 
                success: false, 
                error: `Client with ID '${clientId}' not found` 
            });
        }
        
        return res.status(200).json({
            success: true,
            client: clientStatus
        });
        
    } catch (error) {
        console.error('❌ Error getting client status:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Get QR code for a specific client
app.get('/clients/:clientId/qr', (req: Request, res: Response) => {
    try {
        const { clientId } = req.params;
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId parameter is required' 
            });
        }
        const clientInfo = clientManager.getClient(clientId);
        
        if (!clientInfo) {
            return res.status(404).json({ 
                success: false, 
                error: `Client with ID '${clientId}' not found` 
            });
        }
        
        if (clientInfo.qrCode && clientInfo.status === 'qr_required') {
            return res.status(200).json({
                success: true,
                clientId: clientId,
                qrCode: clientInfo.qrCode,
                status: clientInfo.status,
                message: 'QR code is available for scanning'
            });
        } else if (clientInfo.status === 'ready' || clientInfo.status === 'authenticated') {
            return res.status(200).json({
                success: true,
                clientId: clientId,
                status: clientInfo.status,
                message: 'Client is already authenticated'
            });
        } else {
            return res.status(404).json({
                success: false,
                clientId: clientId,
                status: clientInfo.status,
                message: 'QR code not available yet. Please wait for client to generate one.'
            });
        }
        
    } catch (error) {
        console.error('❌ Error getting QR code:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Send message via specific client
app.post('/clients/:clientId/send', async (req: Request, res: Response) => {
    try {
        const { clientId } = req.params;
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId parameter is required' 
            });
        }
        const { number, message } = req.body;
        
        if (!number || !message) {
            return res.status(400).json({ 
                success: false, 
                error: 'Number and message are required' 
            });
        }
        
        const clientInfo = clientManager.getClient(clientId);
        if (!clientInfo) {
            return res.status(404).json({ 
                success: false, 
                error: `Client with ID '${clientId}' not found` 
            });
        }
        
        if (!clientInfo.isReady) {
            return res.status(400).json({ 
                success: false, 
                error: `Client '${clientId}' is not ready` 
            });
        }
        
        await clientManager.sendMessage(clientId, number, message);
        
        return res.status(200).json({
            success: true,
            message: 'Message sent successfully',
            clientId: clientId,
            to: number
        });
        
                    } catch (error) {
        console.error('❌ Error sending message:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Disconnect a specific client
app.post('/clients/:clientId/disconnect', async (req: Request, res: Response) => {
    try {
        const { clientId } = req.params;
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId parameter is required' 
            });
        }
        
        const clientInfo = clientManager.getClient(clientId);
        if (!clientInfo) {
            return res.status(404).json({ 
                success: false, 
                error: `Client with ID '${clientId}' not found` 
            });
        }
        
        await clientManager.disconnectClient(clientId);
        
        return res.status(200).json({
            success: true,
            message: `Client '${clientId}' disconnected successfully`,
            clientId: clientId
        });
        
    } catch (error) {
        console.error('❌ Error disconnecting client:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Remove a specific client completely
app.delete('/clients/:clientId', async (req: Request, res: Response) => {
    try {
        const { clientId } = req.params;
        if (!clientId) {
            return res.status(400).json({ 
                success: false, 
                error: 'clientId parameter is required' 
            });
        }
        
        const clientInfo = clientManager.getClient(clientId);
        if (!clientInfo) {
            return res.status(404).json({ 
                success: false, 
                error: `Client with ID '${clientId}' not found` 
            });
        }
        
        await clientManager.removeClient(clientId);
        
        return res.status(200).json({
            success: true,
            message: `Client '${clientId}' removed completely`,
            clientId: clientId
        });
        
    } catch (error) {
        console.error('❌ Error removing client:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// ==================== MONGODB SESSION MANAGEMENT ENDPOINTS ====================

// List all sessions in MongoDB
app.get('/sessions', async (req: Request, res: Response) => {
    try {
        // This would require access to the MongoDB store
        // For now, we'll return a message indicating this feature
        return res.status(200).json({
            success: true,
            message: 'MongoDB session listing not yet implemented',
            note: 'Sessions are automatically managed by RemoteAuth'
        });
    } catch (error) {
        console.error('❌ Error listing sessions:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Get MongoDB connection status
app.get('/mongodb/status', (req: Request, res: Response) => {
    try {
        return res.status(200).json({
            success: true,
            mongodbEnabled: true,
            mongodbUri: 'SET',
            message: 'MongoDB RemoteAuth is required and enabled'
        });
    } catch (error) {
        console.error('❌ Error getting MongoDB status:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Manual client recovery endpoint
app.post('/clients/:clientId/recover', async (req: Request, res: Response) => {
    const { clientId } = req.params;
    
    if (!clientId) {
        return res.status(400).json({
            success: false,
            error: 'Client ID is required'
        });
    }

    try {
        const clientInfo = clientManager.getClient(clientId);
        if (!clientInfo) {
            return res.status(404).json({
                success: false,
                error: `Client ${clientId} not found`
            });
        }

        if (clientInfo.status !== 'error') {
            return res.status(400).json({
                success: false,
                error: `Client ${clientId} is not in error status (current status: ${clientInfo.status})`
            });
        }

        console.log(`🔄 Manual recovery requested for client ${clientId}`);
        
        // Trigger recovery
        await clientManager.recoverErrorClient(clientId);
        
        return res.status(200).json({
            success: true,
            message: `Recovery initiated for client ${clientId}`,
            clientId: clientId
        });
        
    } catch (error) {
        console.error(`❌ Error recovering client ${clientId}:`, error);
        return res.status(500).json({
            success: false,
            error: `Failed to recover client ${clientId}`
        });
    }
});

// Debug endpoint to check MongoDB collections
app.get('/mongodb/debug', async (req: Request, res: Response) => {
    try {
        if (!mongoose.connection.db) {
            return res.status(500).json({ 
                success: false, 
                error: 'MongoDB database connection not available' 
            });
        }

        const collections = await mongoose.connection.db.listCollections().toArray();
        const collectionNames = collections.map(col => col.name);
        
        const sessionsData: any = {};
        for (const collectionName of collectionNames) {
            const collection = mongoose.connection.db.collection(collectionName);
            const documents = await collection.find({}).toArray();
            sessionsData[collectionName] = {
                count: documents.length,
                documents: documents.slice(0, 5) // Show first 5 documents
            };
        }

        return res.status(200).json({
            success: true,
            collections: collectionNames,
            data: sessionsData
        });
    } catch (error) {
        console.error('❌ Error debugging MongoDB:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// ==================== COMMAND PROMPT ENDPOINTS ====================

// Command prompt interface
app.post('/cmd', async (req: Request, res: Response) => {
    try {
        const { command, args } = req.body;
        
        if (!command) {
            return res.status(400).json({ 
                success: false, 
                error: 'Command is required' 
            });
        }
        
        let result: any = { success: true };
        
        switch (command.toLowerCase()) {
            case 'list':
                result.clients = clientManager.getAllClientsStatus();
                result.message = `Found ${result.clients.length} clients`;
                break;
                
            case 'create':
                if (!args || !args.clientId) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId argument is required for create command' 
                    });
                }
                const clientInfo = await clientManager.createClient(args.clientId);
                await clientManager.initializeClient(args.clientId);
                result.message = `Client '${args.clientId}' created and initialized`;
                result.clientId = args.clientId;
                break;
                
            case 'status':
                if (!args || !args.clientId) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId argument is required for status command' 
                    });
                }
                const status = clientManager.getClientStatus(args.clientId);
                if (!status) {
                    return res.status(404).json({ 
                        success: false, 
                        error: `Client '${args.clientId}' not found` 
                    });
                }
                result.client = status;
                result.message = `Client '${args.clientId}' status: ${status.status}`;
                break;
                
            case 'qr':
                if (!args || !args.clientId) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId argument is required for qr command' 
                    });
                }
                const clientInfo_qr = clientManager.getClient(args.clientId);
                if (!clientInfo_qr) {
                    return res.status(404).json({ 
                        success: false, 
                        error: `Client '${args.clientId}' not found` 
                    });
                }
                if (clientInfo_qr.qrCode && clientInfo_qr.status === 'qr_required') {
                    result.qrCode = clientInfo_qr.qrCode;
                    result.message = `QR code for client '${args.clientId}' is available`;
        } else {
                    result.message = `QR code for client '${args.clientId}' is not available (status: ${clientInfo_qr.status})`;
                }
                break;
                
            case 'send':
                if (!args || !args.clientId || !args.number || !args.message) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId, number, and message arguments are required for send command' 
                    });
                }
                await clientManager.sendMessage(args.clientId, args.number, args.message);
                result.message = `Message sent via client '${args.clientId}' to ${args.number}`;
                break;
                
            case 'disconnect':
                if (!args || !args.clientId) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId argument is required for disconnect command' 
                    });
                }
                await clientManager.disconnectClient(args.clientId);
                result.message = `Client '${args.clientId}' disconnected`;
                break;
                
            case 'remove':
                if (!args || !args.clientId) {
                    return res.status(400).json({ 
                        success: false, 
                        error: 'clientId argument is required for remove command' 
                    });
                }
                await clientManager.removeClient(args.clientId);
                result.message = `Client '${args.clientId}' removed completely`;
                break;
                
            case 'help':
                result.commands = [
                    'list - List all clients',
                    'create <clientId> - Create a new client',
                    'status <clientId> - Get client status',
                    'qr <clientId> - Get QR code for client',
                    'send <clientId> <number> <message> - Send message via client',
                    'disconnect <clientId> - Disconnect client',
                    'remove <clientId> - Remove client completely',
                    'help - Show this help'
                ];
                result.message = 'Available commands';
                break;
                
            default:
                return res.status(400).json({ 
                    success: false, 
                    error: `Unknown command: ${command}. Use 'help' to see available commands.` 
                });
        }
        
        return res.status(200).json(result);
        
    } catch (error) {
        console.error('❌ Error executing command:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        });
    }
});

// Start Express server
const PORT: number = Number(env.PORT) || 8080;
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
    
    // Close all WhatsApp clients gracefully
    try {
        console.log('📱 Closing all WhatsApp clients gracefully...');
        await clientManager.gracefulShutdown();
        console.log('✅ All WhatsApp clients closed successfully');
        } catch (error) {
        console.error('❌ Error closing WhatsApp clients:', error);
    }
    
    // Session data is managed by MongoDB RemoteAuth - no file preservation needed
    
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