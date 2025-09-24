import { Client, RemoteAuth, Message, Chat } from 'whatsapp-web.js';
import { MongoStore } from 'wwebjs-mongo';
import mongoose from 'mongoose';
import * as qrcode from 'qrcode-terminal';
import * as QRCode from 'qrcode';
// import { ClientAgent } from '../models/client-agent.model';

export interface ClientInfo {
    clientId: string;
    client: Client;
    isReady: boolean;
    phoneNumber?: string | undefined;
    qrCode?: string | undefined;
    lastActivity: Date;
    status: 'initializing' | 'qr_required' | 'authenticated' | 'ready' | 'disconnected' | 'error' | 'session_saved';
    ai_agent_code?: string | undefined;
}

export interface ClientManagerConfig {
    chromiumPath: string;
    puppeteerArgs: string[];
    mongoUri: string;
    backupSyncIntervalMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    healthCheckIntervalMs?: number;
}

export class WhatsAppClientManager {
    private clients: Map<string, ClientInfo> = new Map();
    private config: ClientManagerConfig;
    private messageHandlers: ((clientId: string, message: Message) => Promise<void>)[] = [];
    private mongoStore: any = null;
    private isMongoConnected: boolean = false;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private retryAttempts: Map<string, number> = new Map();

    constructor(config: ClientManagerConfig) {
        this.config = config;
    }

    public async initialize(): Promise<void> {
        await this.initializeMongoDB();
        this.startHealthCheck();
    }

    private startHealthCheck(): void {
        const interval = this.config.healthCheckIntervalMs || 30000; // 30 seconds default
        
        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, interval);
        
        console.log(`🏥 Health check started with ${interval}ms interval`);
    }

    private async performHealthCheck(): Promise<void> {
        const clients = Array.from(this.clients.values());
        
        for (const clientInfo of clients) {
            try {
                // Check if client is stuck in initializing for too long
                if (clientInfo.status === 'initializing') {
                    const timeSinceLastActivity = Date.now() - clientInfo.lastActivity.getTime();
                    const maxInitializingTime = 120000; // 2 minutes (reduced from 5 minutes)
                    
                    if (timeSinceLastActivity > maxInitializingTime) {
                        console.warn(`⚠️ Client ${clientInfo.clientId} stuck in initializing for ${Math.round(timeSinceLastActivity / 1000)}s. Triggering automatic fallback to QR scanning...`);
                        
                        // Trigger automatic fallback instead of recovery
                        await this.resetClientToQRScanning(clientInfo.clientId);
                    }
                }
                
                // Check if ready client is still responsive
                if (clientInfo.status === 'ready' && clientInfo.isReady) {
                    try {
                        const state = await clientInfo.client.getState();
                        if (state === 'UNPAIRED' || state === 'UNLAUNCHED') {
                            console.warn(`⚠️ Client ${clientInfo.clientId} state changed to ${state}. Marking as disconnected.`);
                            clientInfo.status = 'disconnected';
                            clientInfo.isReady = false;
                        }
                    } catch (error) {
                        console.warn(`⚠️ Health check failed for client ${clientInfo.clientId}:`, error);
                        
                        // Check if this is a "Target closed" error (user logout)
                        const isTargetClosed = error instanceof Error && 
                            (error.message.includes('Target closed') || 
                             error.message.includes('Execution context was destroyed') ||
                             error.message.includes('Session closed'));
                        
                        if (isTargetClosed) {
                            console.log(`🔍 Detected user logout for client ${clientInfo.clientId}. Resetting to QR scanning.`);
                            await this.resetClientToQRScanning(clientInfo.clientId);
                        } else {
                            clientInfo.status = 'error';
                            clientInfo.isReady = false;
                        }
                    }
                }
                
                // Check if client is in error status and attempt recovery
                if (clientInfo.status === 'error') {
                    const timeSinceLastActivity = Date.now() - clientInfo.lastActivity.getTime();
                    const errorRecoveryDelay = 30000; // 30 seconds delay before attempting fallback (reduced from 1 minute)
                    
                    if (timeSinceLastActivity > errorRecoveryDelay) {
                        console.log(`🔄 Client ${clientInfo.clientId} has been in error status for ${Math.round(timeSinceLastActivity / 1000)}s. Triggering automatic fallback to QR scanning...`);
                        await this.resetClientToQRScanning(clientInfo.clientId);
                    }
                }
                
            } catch (error) {
                console.error(`❌ Health check error for client ${clientInfo.clientId}:`, error);
            }
        }
    }

    private async recoverStuckClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) return;

        console.log(`🔄 Attempting to recover stuck client ${clientId}...`);
        
        try {
            // Force destroy the stuck client
            await clientInfo.client.destroy();
        } catch (error) {
            console.warn(`⚠️ Error destroying stuck client:`, error);
        }

        // Recreate the client
        await this.recreateClient(clientId);
        
        // Retry initialization
        this.initializeClient(clientId).catch(error => {
            console.error(`❌ Failed to recover client ${clientId}:`, error);
        });
    }

    public async recoverErrorClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) return;

        console.log(`🔄 Attempting to recover client ${clientId} from error status...`);
        
        try {
            // Force destroy the error client
            await clientInfo.client.destroy();
        } catch (error) {
            console.warn(`⚠️ Error destroying error client:`, error);
        }

        // Recreate the client
        await this.recreateClient(clientId);
        
        // Update status and last activity
        clientInfo.status = 'initializing';
        clientInfo.lastActivity = new Date();
        
        // Retry initialization with the robust retry mechanism
        this.initializeClient(clientId).catch(error => {
            console.error(`❌ Failed to recover client ${clientId} from error:`, error);
        });
    }

    public async resetClientToQRScanning(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) return;

        try {
            console.log(`🔄 Resetting client ${clientId} to QR scanning mode...`);
            
            // Clean up the existing client
            try {
                await clientInfo.client.destroy();
            } catch (cleanupError) {
                console.warn(`⚠️ Error during client cleanup:`, cleanupError);
            }

            // Clean up MongoDB session data
            await this.cleanupMongoSession(clientId);

            // Remove the client from our map
            this.clients.delete(clientId);

            // Recreate the client (this will generate a new QR code)
            await this.createClient(clientId);
            console.log(`✅ Client ${clientId} reset to QR scanning mode successfully`);
            
        } catch (error) {
            console.error(`❌ Failed to reset client ${clientId} to QR scanning:`, error);
        }
    }

    private async cleanupMongoSession(clientId: string): Promise<void> {
        if (!this.isMongoConnected || !this.mongoStore) {
            console.warn(`⚠️ MongoDB not connected, cannot cleanup session for ${clientId}`);
            return;
        }

        try {
            console.log(`🧹 Cleaning up MongoDB session for client ${clientId} using wwebjs-mongo API...`);
            
            // Use the proper wwebjs-mongo delete method
            await this.mongoStore.delete({ session: clientId });
            console.log(`✅ MongoDB session cleanup completed for client ${clientId} using wwebjs-mongo API`);
            
        } catch (error) {
            console.error(`❌ Error during MongoDB session cleanup for ${clientId}:`, error);
            
            // Fallback to manual cleanup if the API method fails
            try {
                console.log(`🔄 Attempting fallback manual cleanup for client ${clientId}...`);
                
                if (!mongoose.connection.db) {
                    throw new Error('MongoDB database connection not available');
                }

                // Remove all session collections (both .files and .chunks for GridFS)
                const collections = await mongoose.connection.db.listCollections().toArray();
                const sessionCollections = collections.filter(col => 
                    col.name.startsWith(`whatsapp-RemoteAuth-${clientId}`)
                );

                console.log(`🗑️ Found ${sessionCollections.length} session collections to clean up for client ${clientId}:`);
                sessionCollections.forEach(col => console.log(`   - ${col.name}`));

                for (const collection of sessionCollections) {
                    try {
                        await mongoose.connection.db.collection(collection.name).drop();
                        console.log(`✅ Dropped collection: ${collection.name}`);
                    } catch (dropError) {
                        console.warn(`⚠️ Failed to drop collection ${collection.name}:`, dropError);
                    }
                }

                console.log(`✅ Fallback manual cleanup completed for client ${clientId}`);
                
            } catch (fallbackError) {
                console.error(`❌ Fallback cleanup also failed for client ${clientId}:`, fallbackError);
            }
        }
    }


    private async initializeMongoDB(): Promise<void> {
        try {
            console.log('🔗 Connecting to MongoDB...');
            await mongoose.connect(this.config.mongoUri);
            console.log('✅ Connected to MongoDB successfully');
            
            this.mongoStore = new MongoStore({ mongoose: mongoose });
            this.isMongoConnected = true;
            console.log('✅ MongoDB store initialized for RemoteAuth');
            
        } catch (error) {
            console.error('❌ Failed to connect to MongoDB:', error);
            throw new Error('MongoDB connection is required. Please provide a valid MONGODB_URI.');
        }
    }


    public async createClient(clientId: string): Promise<ClientInfo> {
        if (this.clients.has(clientId)) {
            throw new Error(`Client with ID '${clientId}' already exists`);
        }

        console.log(`🚀 Creating new WhatsApp client: ${clientId}`);

        if (!this.isMongoConnected || !this.mongoStore) {
            throw new Error('MongoDB connection is required. Please ensure MONGODB_URI is set and MongoDB is connected.');
        }

        console.log(`🔗 Using RemoteAuth (MongoDB) for client ${clientId}`);
        
        // Ensure the data path directory exists
        const fs = require('fs');
        const path = require('path');
        const dataPath = '.wwebjs_auth';
        if (!fs.existsSync(dataPath)) {
            fs.mkdirSync(dataPath, { recursive: true });
            console.log(`📁 Created data path directory: ${dataPath}`);
        }
        
        const authStrategy = new RemoteAuth({
            store: this.mongoStore,
            clientId: clientId, // Required for multiple sessions
            backupSyncIntervalMs: 300000 // 5 minutes default
        });
        
        console.log(`🔍 DEBUG: RemoteAuth configured for client ${clientId} with backupSyncIntervalMs: 300000`);
        
        // Test MongoStore functionality
        try {
            const testSessionExists = await this.mongoStore.sessionExists({ session: clientId });
            console.log(`🔍 DEBUG: MongoStore test - session exists check for ${clientId}: ${testSessionExists}`);
        } catch (error) {
            console.error(`❌ DEBUG: MongoStore test failed for ${clientId}:`, error);
        }

        const client = new Client({
            authStrategy: authStrategy,
            puppeteer: {
                headless: true,
                executablePath: this.config.chromiumPath,
                args: this.config.puppeteerArgs,
                timeout: 0,
                defaultViewport: null,
                ignoreDefaultArgs: ['--disable-extensions']
            }
        });

        const clientInfo: ClientInfo = {
            clientId,
            client,
            isReady: false,
            lastActivity: new Date(),
            status: 'initializing'
        };

        this.setupClientEventHandlers(clientInfo);
        this.clients.set(clientId, clientInfo);

        // Initialize the client to start the authentication process (non-blocking)
        this.initializeClient(clientId).catch(error => {
            console.error(`❌ Failed to initialize client ${clientId}:`, error);
        });

        console.log(`✅ Client ${clientId} created successfully`);
        return clientInfo;
    }

    private setupClientEventHandlers(clientInfo: ClientInfo): void {
        const { client, clientId } = clientInfo;

        // QR Code event
        client.on('qr', async (qr: string) => {
            try {
                // Generate base64-encoded PNG QR code
                const qrCodeImage = await QRCode.toDataURL(qr, {
                    type: 'image/png',
                    width: 256,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                });
                
                // Store the base64 image (remove data:image/png;base64, prefix)
                clientInfo.qrCode = qrCodeImage.split(',')[1];
            } catch (error) {
                console.error(`❌ Error generating QR code image for client ${clientId}:`, error);
                // Fallback to raw QR string
                clientInfo.qrCode = qr;
            }
            
            clientInfo.status = 'qr_required';
            clientInfo.lastActivity = new Date();
        });

        // Authentication success
        client.on('authenticated', () => {
            console.log(`✅ Client ${clientId} authenticated successfully`);
            clientInfo.status = 'authenticated';
            clientInfo.qrCode = undefined;
            clientInfo.lastActivity = new Date();
        });

        // Remote session saved (for RemoteAuth) - this is crucial for session persistence
        client.on('remote_session_saved', () => {
            console.log(`🔍 DEBUG: remote_session_saved event fired for client ${clientId}`);
            console.log(`💾 Remote session saved for client ${clientId} in MongoDB - session will persist across restarts!`);
            clientInfo.status = 'session_saved';
            clientInfo.lastActivity = new Date();
            
            // Emit a custom event to notify waiting processes
            client.emit('session_saved_notification');
        });

        // Also listen for any other relevant events
        client.on('change_state', (state) => {
            console.log(`🔍 DEBUG: Client ${clientId} state changed to: ${state}`);
        });

        // Client ready
        client.on('ready', () => {
            console.log(`✅ Client ${clientId} is ready!`);
            clientInfo.isReady = true;
            // Only set status to 'ready' if it's not already 'session_saved'
            if (clientInfo.status !== 'session_saved') {
                clientInfo.status = 'ready';
            }
            clientInfo.phoneNumber = client.info?.wid?._serialized;
            clientInfo.lastActivity = new Date();
            console.log(`📞 Client ${clientId} phone number: ${clientInfo.phoneNumber}`);
            
            // Manually trigger session save after a short delay
            setTimeout(async () => {
                try {
                    console.log(`💾 Manually triggering session save for client ${clientId}...`);
                    // Force save the session using RemoteAuth
                    const authStrategy = (client as any).authStrategy;
                    if (authStrategy && typeof authStrategy.save === 'function') {
                        await authStrategy.save();
                        console.log(`✅ Manual session save completed for client ${clientId}`);
                    } else {
                        console.log(`⚠️ No save method available on auth strategy for client ${clientId}`);
                    }
                } catch (error) {
                    console.error(`❌ Error manually saving session for client ${clientId}:`, error);
                }
            }, 5000); // 5 seconds delay
            
            // Set a timeout to check if session gets saved (fallback mechanism)
            setTimeout(() => {
                if (clientInfo.status === 'ready') {
                    console.log(`⏰ Session save timeout check for client ${clientId} - still in 'ready' status, checking MongoDB...`);
                    // Check if session exists in MongoDB
                    this.mongoStore.sessionExists({ session: clientId })
                        .then((exists: boolean) => {
                            if (exists) {
                                console.log(`💾 Session found in MongoDB for client ${clientId} - updating status to 'session_saved'`);
                                clientInfo.status = 'session_saved';
                                clientInfo.lastActivity = new Date();
                            } else {
                                console.log(`⚠️ Session not found in MongoDB for client ${clientId} after timeout`);
                            }
                        })
                        .catch((error: any) => {
                            console.error(`❌ Error checking session existence for client ${clientId}:`, error);
                        });
                }
            }, 120000); // 2 minutes timeout
        });

        // Authentication failure
        client.on('auth_failure', (msg: string) => {
            console.error(`❌ Authentication failed for client ${clientId}:`, msg);
            clientInfo.status = 'error';
            clientInfo.lastActivity = new Date();
        });

        // Disconnection
        client.on('disconnected', (reason: string) => {
            console.log(`❌ Client ${clientId} disconnected:`, reason);
            clientInfo.isReady = false;
            clientInfo.status = 'disconnected';
            clientInfo.lastActivity = new Date();
        });

        // Message events
        client.on('message', async (message: Message) => {
            console.log(`📨 Message received on client ${clientId} from:`, message.from);
            console.log(`📨 Message body:`, message.body);
            console.log(`📨 Message quoted:`, message.hasQuotedMsg);
            console.log(`📨 Message raw:`, message.hasQuotedMsg);
            if (message.hasQuotedMsg) {
                const quoted = await message.getQuotedMessage();
                console.log('User replied to:', quoted.body);
            }
            
            clientInfo.lastActivity = new Date();
            
            // Trigger session save on first message if not already saved
            if (clientInfo.status === 'ready') {
                try {
                    console.log(`💾 Triggering session save on first message for client ${clientId}...`);
                    const authStrategy = (client as any).authStrategy;
                    if (authStrategy && typeof authStrategy.save === 'function') {
                        await authStrategy.save();
                        console.log(`✅ Session save triggered on message for client ${clientId}`);
                    }
                } catch (error) {
                    console.error(`❌ Error saving session on message for client ${clientId}:`, error);
                }
            }
            
            // Call all registered message handlers
            for (const handler of this.messageHandlers) {
                try {
                    await handler(clientId, message);
                } catch (error) {
                    console.error(`❌ Error in message handler for client ${clientId}:`, error);
                }
            }
        });

        client.on('message_create', async (message: Message) => {
            console.log(`📨 Message created on client ${clientId} from:`, message.from);
            clientInfo.lastActivity = new Date();
        });

        // Loading screen
        client.on('loading_screen', (percent: string, message: string) => {
            console.log(`📱 Client ${clientId} loading: ${percent}% - ${message}`);
        });

        // State changes
        client.on('change_state', (state: string) => {
            console.log(`📊 Client ${clientId} state changed:`, state);
        });
    }

    public async initializeClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client with ID '${clientId}' not found`);
        }

        const maxRetries = this.config.maxRetries || 3;
        const baseDelay = this.config.retryDelayMs || 2000;
        let attempt = 0;

        while (attempt < maxRetries) {
            try {
                attempt++;
                console.log(`🔄 Initializing client ${clientId} (attempt ${attempt}/${maxRetries})...`);
                clientInfo.status = 'initializing';
                clientInfo.lastActivity = new Date();
                
                // Set a timeout for the initialization
                const initPromise = clientInfo.client.initialize();
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Initialization timeout after 60 seconds')), 60000);
                });

                await Promise.race([initPromise, timeoutPromise]);
                console.log(`✅ Client ${clientId} initialized successfully`);
                
                // Reset retry counter on success
                this.retryAttempts.delete(clientId);
                return;

            } catch (error) {
                console.error(`❌ Client initialization failed (attempt ${attempt}/${maxRetries}):`, error);
                
                // Check if this is a "Target closed" error (user logout)
                const isTargetClosed = error instanceof Error && 
                    (error.message.includes('Target closed') || 
                     error.message.includes('Execution context was destroyed') ||
                     error.message.includes('Session closed'));
                
                if (isTargetClosed) {
                    console.log(`🔍 Detected user logout for client ${clientId}. Will reset to QR scanning.`);
                }
                
                if (attempt >= maxRetries) {
                    console.error(`❌ Max retries reached for client ${clientId}. Resetting to QR scanning.`);
                    
                    // Fallback: Reset client to QR scanning
                    await this.resetClientToQRScanning(clientId);
                    return;
                }

                // Exponential backoff with jitter
                const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
                console.log(`⏳ Retrying in ${Math.round(delay)}ms...`);
                
                // Clean up failed client before retry
                try {
                    await clientInfo.client.destroy();
                } catch (cleanupError) {
                    console.warn(`⚠️ Error during client cleanup:`, cleanupError);
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Recreate client for retry (but only if not target closed)
                if (!isTargetClosed) {
                    try {
                        await this.recreateClient(clientId);
                    } catch (recreateError) {
                        console.error(`❌ Failed to recreate client ${clientId}:`, recreateError);
                        // Continue with retry using existing client
                    }
                }
            }
        }
    }

    private async recreateClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client ${clientId} not found for recreation`);
        }

        console.log(`🔄 Recreating client ${clientId}...`);
        
        try {
            // Destroy the existing client
            await clientInfo.client.destroy();
        } catch (error) {
            console.warn(`⚠️ Error destroying client during recreation:`, error);
        }

        // Create a new client with the same configuration
        const authStrategy = new RemoteAuth({
            clientId: clientId,
            store: this.mongoStore,
            backupSyncIntervalMs: this.config.backupSyncIntervalMs || 300000
        });

        const newClient = new Client({
            authStrategy: authStrategy,
            puppeteer: {
                headless: true,
                executablePath: this.config.chromiumPath,
                args: this.config.puppeteerArgs,
                timeout: 0,
                defaultViewport: null,
                ignoreDefaultArgs: ['--disable-extensions']
            }
        });

        // Update the client info with the new client
        clientInfo.client = newClient;
        clientInfo.isReady = false;
        clientInfo.status = 'initializing';
        clientInfo.phoneNumber = undefined;
        clientInfo.qrCode = undefined;
        clientInfo.lastActivity = new Date();

        // Re-setup event handlers for the new client
        this.setupClientEventHandlers(clientInfo);
        
        console.log(`✅ Client ${clientId} recreated successfully`);
    }

    public async disconnectClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client with ID '${clientId}' not found`);
        }

        console.log(`🔄 Disconnecting client ${clientId}...`);
        
        try {
            await clientInfo.client.destroy();
            clientInfo.isReady = false;
            clientInfo.status = 'disconnected';
            clientInfo.phoneNumber = undefined;
            clientInfo.qrCode = undefined;
            clientInfo.lastActivity = new Date();
            
            console.log(`✅ Client ${clientId} disconnected successfully`);
        } catch (error) {
            console.error(`❌ Error disconnecting client ${clientId}:`, error);
            throw error;
        }
    }

    public async removeClient(clientId: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client with ID '${clientId}' not found`);
        }

        // Disconnect first
        await this.disconnectClient(clientId);
        
        // Remove from map
        this.clients.delete(clientId);
        
        // Clean up MongoDB session data
        try {
            if (this.mongoStore) {
                await this.mongoStore.delete({ session: clientId });
                console.log(`🧹 Removed MongoDB session data for client ${clientId}`);
            }
        } catch (error) {
            console.error(`⚠️ Error removing MongoDB session for client ${clientId}:`, error);
        }
        
        console.log(`✅ Client ${clientId} removed completely`);
    }

    public getClient(clientId: string): ClientInfo | undefined {
        return this.clients.get(clientId);
    }

    public getAllClients(): ClientInfo[] {
        return Array.from(this.clients.values());
    }

    public getClientStatus(clientId: string): any {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            return null;
        }

        return {
            clientId: clientInfo.clientId,
            status: clientInfo.status,
            isReady: clientInfo.isReady,
            phoneNumber: clientInfo.phoneNumber,
            hasQrCode: !!clientInfo.qrCode,
            lastActivity: clientInfo.lastActivity,
            uptime: Date.now() - clientInfo.lastActivity.getTime()
        };
    }

    public getAllClientsStatus(): any[] {
        return this.getAllClients().map(client => this.getClientStatus(client.clientId));
    }

    public async sendMessage(clientId: string, chatId: string, message: string): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client with ID '${clientId}' not found`);
        }

        if (!clientInfo.isReady) {
            throw new Error(`Client ${clientId} is not ready`);
        }

        const formattedChatId = chatId.includes('@') ? chatId : `${chatId}@c.us`;
        await clientInfo.client.sendMessage(formattedChatId, message);
        console.log(`✅ Message sent via client ${clientId} to ${formattedChatId}`);
    }

    public addMessageHandler(handler: (clientId: string, message: Message) => Promise<void>): void {
        this.messageHandlers.push(handler);
    }

    public removeMessageHandler(handler: (clientId: string, message: Message) => Promise<void>): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index > -1) {
            this.messageHandlers.splice(index, 1);
        }
    }

    public async loadAgentAssignments(): Promise<void> {
        try {
            console.log('🔄 Starting to load agent assignments...');
            
            // Get the ClientAgent model (it should already be compiled by the service)
            let ClientAgent: any;
            try {
                ClientAgent = mongoose.model('ClientAgent');
                console.log('✅ ClientAgent model found');
            } catch (error) {
                console.log('⚠️ ClientAgent model not found, skipping agent assignment loading:', error);
                return;
            }
            
            const assignments = await ClientAgent.find({ isActive: true });
            console.log(`📋 Found ${assignments.length} agent assignments in MongoDB:`, assignments);
            
            for (const assignment of assignments) {
                const clientInfo = this.clients.get(assignment.clientId);
                console.log(`🔍 Looking for client ${assignment.clientId} in clients map:`, !!clientInfo);
                if (clientInfo) {
                    clientInfo.ai_agent_code = assignment.ai_agent_code;
                    console.log(`🤖 Loaded agent assignment for client ${assignment.clientId}: ${assignment.ai_agent_code}`);
                } else {
                    console.log(`⚠️ Client ${assignment.clientId} not found in clients map`);
                }
            }
            
            console.log(`✅ Loaded ${assignments.length} agent assignments from MongoDB`);
        } catch (error) {
            console.error('❌ Error loading agent assignments:', error);
        }
    }

    public async restoreExistingSessions(): Promise<void> {
        if (!this.isMongoConnected || !this.mongoStore) {
            console.log('⚠️ MongoDB not connected, skipping session restoration');
            return;
        }

        try {
            console.log('🔄 Restoring existing sessions from MongoDB...');
            
            // Get all collections and find WhatsApp RemoteAuth sessions
            if (!mongoose.connection.db) {
                throw new Error('MongoDB database connection not available');
            }
            
            const collections = await mongoose.connection.db.listCollections().toArray();
            const sessionFileCollections = collections.filter(col => 
                col.name.startsWith('whatsapp-RemoteAuth-') && 
                col.name.endsWith('.files')
            );
            
            console.log(`📋 Found ${sessionFileCollections.length} existing session file collections in MongoDB`);
            
            if (sessionFileCollections.length === 0) {
                console.log('✅ No existing sessions to restore');
                return;
            }

            // Restore each session asynchronously (completely non-blocking)
            sessionFileCollections.forEach((collection) => {
                // Start each client restoration independently without waiting
                (async () => {
                    try {
                        // Extract clientId from collection name (whatsapp-RemoteAuth-{clientId}.files)
                        const clientId = collection.name.replace('whatsapp-RemoteAuth-', '').replace('.files', '');
                        console.log(`🔄 Restoring session for client: ${clientId}`);
                        
                        // Directly attempt to create client for existing session collection
                        // The RemoteAuth strategy will handle the session restoration automatically
                        console.log(`✅ Found session collection for client ${clientId}, creating client to restore...`);
                        try {
                            await this.createClient(clientId);
                            
                            // Wait for the client to become ready (up to 5 minutes as per documentation)
                            console.log(`⏳ Waiting for client ${clientId} to authenticate and become ready...`);
                            await this.waitForClientReady(clientId, 300000); // 5 minutes timeout
                            
                            const clientInfo = this.clients.get(clientId);
                            if (clientInfo && clientInfo.isReady) {
                                console.log(`✅ Successfully restored session for client: ${clientId} - Client is ready!`);
                                
                                // Wait for the remote_session_saved event (up to 2 minutes as per documentation)
                                console.log(`⏳ Waiting for session to be saved to MongoDB for client ${clientId}...`);
                                await this.waitForSessionSaved(clientId, 120000); // 2 minutes timeout
                                
                                const updatedClientInfo = this.clients.get(clientId);
                                if (updatedClientInfo && updatedClientInfo.status === 'session_saved') {
                                    console.log(`💾 Session successfully saved for client ${clientId} - will persist across restarts!`);
                                } else {
                                    console.log(`⚠️ Session not yet saved for client ${clientId}, but client is ready`);
                                }
                            } else if (clientInfo && clientInfo.status === 'qr_required') {
                                console.log(`⚠️ Session restoration failed for client ${clientId} - QR code required (session may be corrupted or expired)`);
                                // Clean up corrupted session
                                console.log(`🧹 Cleaning up corrupted session for client ${clientId}...`);
                                await this.cleanupMongoSession(clientId);
                            } else {
                                console.log(`⚠️ Session restoration status unknown for client ${clientId} - Status: ${clientInfo?.status}`);
                            }
                        } catch (createError) {
                            console.log(`⚠️ Failed to restore session for client ${clientId}:`, createError instanceof Error ? createError.message : String(createError));
                        }
                    } catch (error) {
                        console.error(`❌ Failed to restore session for client ${collection.name}:`, error);
                    }
                })();
            });
            
            console.log('✅ Session restoration completed');
            
            // Load agent assignments after a delay to ensure all clients are fully ready
            setTimeout(async () => {
                await this.loadAgentAssignments();
            }, 5000); // 5 seconds delay
        } catch (error) {
            console.error('❌ Error during session restoration:', error);
        }
    }

    private async waitForClientReady(clientId: string, timeoutMs: number): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client ${clientId} not found`);
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`⏰ Client ready timeout for client ${clientId} after ${timeoutMs}ms`);
                resolve(); // Don't reject, just resolve to continue
            }, timeoutMs);

            const checkStatus = () => {
                console.log(`🔍 Checking client ready status for client ${clientId}: ${clientInfo.status}, ready: ${clientInfo.isReady}`);
                
                if (clientInfo.isReady) {
                    console.log(`✅ Client ${clientId} is ready!`);
                    clearTimeout(timeout);
                    resolve();
                } else if (clientInfo.status === 'qr_required') {
                    console.log(`📱 Client ${clientId} requires QR code`);
                    clearTimeout(timeout);
                    resolve();
                } else if (clientInfo.status === 'error') {
                    console.log(`❌ Client ${clientId} authentication failed with error status`);
                    clearTimeout(timeout);
                    resolve(); // Don't reject, just resolve to continue
                } else if (clientInfo.status === 'session_saved') {
                    console.log(`💾 Client ${clientId} session is saved!`);
                    clearTimeout(timeout);
                    resolve();
                }
            };

            // Check immediately
            checkStatus();

            // Set up event listeners for status changes
            const statusCheckInterval = setInterval(() => {
                if (clientInfo.isReady || clientInfo.status === 'qr_required' || clientInfo.status === 'error' || clientInfo.status === 'session_saved') {
                    clearInterval(statusCheckInterval);
                    checkStatus();
                }
            }, 1000);

            // Clean up interval on timeout
            setTimeout(() => {
                clearInterval(statusCheckInterval);
            }, timeoutMs);
        });
    }

    private async waitForSessionSaved(clientId: string, timeoutMs: number): Promise<void> {
        const clientInfo = this.clients.get(clientId);
        if (!clientInfo) {
            throw new Error(`Client ${clientId} not found`);
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                console.log(`⏰ Session save timeout for client ${clientId} after ${timeoutMs}ms`);
                resolve();
            }, timeoutMs);

            const checkStatus = () => {
                console.log(`🔍 Checking session save status for client ${clientId}: ${clientInfo.status}`);
                
                if (clientInfo.status === 'session_saved') {
                    console.log(`💾 Session saved for client ${clientId}!`);
                    clearTimeout(timeout);
                    resolve();
                }
            };

            // Check immediately
            checkStatus();

            // Listen for the session_saved_notification event
            const onSessionSaved = () => {
                console.log(`💾 Session saved event received for client ${clientId}!`);
                clearTimeout(timeout);
                clientInfo.client.removeListener('session_saved_notification', onSessionSaved);
                resolve();
            };

            clientInfo.client.on('session_saved_notification', onSessionSaved);

            // Set up event listeners for status changes as fallback
            const statusCheckInterval = setInterval(() => {
                if (clientInfo.status === 'session_saved') {
                    clearInterval(statusCheckInterval);
                    clientInfo.client.removeListener('session_saved_notification', onSessionSaved);
                    checkStatus();
                }
            }, 1000);

            // Clean up interval and listener on timeout
            setTimeout(() => {
                clearInterval(statusCheckInterval);
                clientInfo.client.removeListener('session_saved_notification', onSessionSaved);
            }, timeoutMs);
        });
    }

    public async gracefulShutdown(): Promise<void> {
        console.log('🛑 Shutting down all WhatsApp clients...');
        
        // Stop health check
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
            console.log('✅ Health check stopped');
        }
        
        const shutdownPromises = Array.from(this.clients.keys()).map(async (clientId) => {
            try {
                await this.disconnectClient(clientId);
            } catch (error) {
                console.error(`❌ Error shutting down client ${clientId}:`, error);
            }
        });

        await Promise.all(shutdownPromises);
        console.log('✅ All clients shut down successfully');
        
        // Close MongoDB connection if connected
        if (this.isMongoConnected) {
            try {
                await mongoose.connection.close();
                console.log('✅ MongoDB connection closed');
            } catch (error) {
                console.error('❌ Error closing MongoDB connection:', error);
            }
        }
    }
}
