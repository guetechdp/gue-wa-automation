import { Client, RemoteAuth, Message, Chat } from 'whatsapp-web.js';
import { MongoStore } from 'wwebjs-mongo';
import mongoose from 'mongoose';
import * as qrcode from 'qrcode-terminal';

export interface ClientInfo {
    clientId: string;
    client: Client;
    isReady: boolean;
    phoneNumber?: string | undefined;
    qrCode?: string | undefined;
    lastActivity: Date;
    status: 'initializing' | 'qr_required' | 'authenticated' | 'ready' | 'disconnected' | 'error';
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
                    const maxInitializingTime = 300000; // 5 minutes
                    
                    if (timeSinceLastActivity > maxInitializingTime) {
                        console.warn(`⚠️ Client ${clientInfo.clientId} stuck in initializing for ${Math.round(timeSinceLastActivity / 1000)}s. Attempting recovery...`);
                        
                        // Attempt to recover the stuck client
                        await this.recoverStuckClient(clientInfo.clientId);
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
                        clientInfo.status = 'error';
                        clientInfo.isReady = false;
                    }
                }
                
                // Check if client is in error status and attempt recovery
                if (clientInfo.status === 'error') {
                    const timeSinceLastActivity = Date.now() - clientInfo.lastActivity.getTime();
                    const errorRecoveryDelay = 60000; // 1 minute delay before attempting recovery
                    
                    if (timeSinceLastActivity > errorRecoveryDelay) {
                        console.log(`🔄 Attempting to recover client ${clientInfo.clientId} from error status...`);
                        await this.recoverErrorClient(clientInfo.clientId);
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
        
        const authStrategy = new RemoteAuth({
            clientId: clientId,
            store: this.mongoStore,
            backupSyncIntervalMs: this.config.backupSyncIntervalMs || 300000 // 5 minutes default
        });

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
        client.on('qr', (qr: string) => {
            console.log(`🔐 QR Code generated for client ${clientId}:`);
            qrcode.generate(qr, { small: true });
            console.log(`📱 Scan this QR code with WhatsApp for client ${clientId}`);
            
            clientInfo.qrCode = qr;
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

        // Remote session saved (for RemoteAuth)
        client.on('remote_session_saved', () => {
            console.log(`💾 Remote session saved for client ${clientId} in MongoDB`);
            clientInfo.lastActivity = new Date();
        });

        // Client ready
        client.on('ready', () => {
            console.log(`✅ Client ${clientId} is ready!`);
            clientInfo.isReady = true;
            clientInfo.status = 'ready';
            clientInfo.phoneNumber = client.info?.wid?._serialized;
            clientInfo.lastActivity = new Date();
            console.log(`📞 Client ${clientId} phone number: ${clientInfo.phoneNumber}`);
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
            
            clientInfo.lastActivity = new Date();
            
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

        const maxRetries = this.config.maxRetries || 5;
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
                
                if (attempt >= maxRetries) {
                    console.error(`❌ Max retries reached for client ${clientId}. Marking as error.`);
                    clientInfo.status = 'error';
                    this.retryAttempts.delete(clientId);
                    throw error;
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
                
                // Recreate client for retry
                try {
                    await this.recreateClient(clientId);
                } catch (recreateError) {
                    console.error(`❌ Failed to recreate client ${clientId}:`, recreateError);
                    // Continue with retry using existing client
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
                        
                        // Since we found the session file collection, try to create the client directly
                        // The createClient method will handle session validation internally
                        try {
                            await this.createClient(clientId);
                            console.log(`✅ Successfully restored session for client: ${clientId}`);
                        } catch (createError) {
                            console.log(`⚠️ Failed to restore session for client ${clientId}:`, createError instanceof Error ? createError.message : String(createError));
                        }
                    } catch (error) {
                        console.error(`❌ Failed to restore session for client ${collection.name}:`, error);
                    }
                })();
            });
            
            console.log('✅ Session restoration completed');
        } catch (error) {
            console.error('❌ Error during session restoration:', error);
        }
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
