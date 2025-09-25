import express, { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { WhatsAppService } from './services/whatsapp.service';
import { MessageHandler } from './core/message-handler';
import { WhatsAppController } from './controllers/whatsapp.controller';
import { ApiController } from './controllers/api.controller';
import { createWhatsAppRoutes } from './routes/whatsapp.routes';
import { createApiRoutes } from './routes/api.routes';
import { Environment } from './types';
import { swaggerSpec } from './config/swagger';
import { createAuthMiddleware } from './middleware/auth.middleware';
import fs from 'fs';

export class WhatsAppBotApp {
    private app: Express;
    private whatsappService: WhatsAppService;
    private messageHandler: MessageHandler;
    private whatsappController: WhatsAppController;
    private apiController: ApiController;

    constructor(private env: Environment) {
        this.app = express();
        this.app.use(express.json());
        
        // Serve static files (for Swagger UI themes)
        this.app.use('/public', express.static('public'));
        
        // Configure WhatsApp service
        const whatsappConfig = {
            chromiumPath: env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
            puppeteerArgs: [
                // Security and sandbox
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                
                // Memory optimization (adjusted for stability)
                '--memory-pressure-off',
                '--max_old_space_size=1024',
                '--max-heap-size=1024',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-background-networking',
                '--disable-background-sync',
                '--disable-client-side-phishing-detection',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--disable-web-security',
                
                // Performance optimization (removed --single-process for stability)
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-gpu-sandbox',
                '--disable-software-rasterizer',
                '--disable-features=VizDisplayCompositor',
                '--no-first-run',
                '--no-zygote',
                '--no-default-browser-check',
                
                // Resource limits (adjusted for stability)
                '--memory-pressure-off',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
                
                // Network optimization
                '--disable-background-networking',
                '--disable-background-sync',
                '--disable-client-side-phishing-detection',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                '--disable-hang-monitor',
                '--disable-ipc-flooding-protection',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--disable-web-security',
                
                // UI optimization
                '--hide-scrollbars',
                '--mute-audio',
                '--no-first-run',
                '--safebrowsing-disable-auto-update',
                
                // SSL and certificates
                '--ignore-ssl-errors',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--allow-running-insecure-content',
                
                // Additional memory optimizations
                '--enable-features=NetworkService,NetworkServiceLogging',
                '--disable-features=VizDisplayCompositor,TranslateUI',
                '--force-color-profile=srgb',
                '--metrics-recording-only'
            ],
            mongoUri: env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-bot',
            backupSyncIntervalMs: 600000, // 10 minutes (reduced frequency)
            maxRetries: 3, // Reduced retries
            retryDelayMs: 5000, // Increased delay between retries
            healthCheckIntervalMs: 120000 // 2 minutes (reduced frequency)
        };
        
        // Initialize services
        this.whatsappService = new WhatsAppService(whatsappConfig);
        this.messageHandler = new MessageHandler(this.whatsappService, env);
        this.whatsappController = new WhatsAppController(this.whatsappService);
        this.apiController = new ApiController(this.whatsappService, env);
        
        this.setupRoutes();
        this.setupMessageHandling();
        this.setupMemoryOptimization();
    }

    private setupRoutes(): void {
        // Setup Swagger documentation with Monokai theme
        let monokaiCSS = '';
        try {
            monokaiCSS = fs.readFileSync('public/css/theme-monokai.css', 'utf8');
        } catch (error) {
            console.warn('⚠️ Monokai CSS file not found, using default Swagger theme');
        }
        
        // Setup Swagger UI with minimal configuration for debugging
        this.app.use('/documentation', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
            explorer: true,
            customCss: `
                .swagger-ui .topbar { display: none }
                ${monokaiCSS}
            `,
            customSiteTitle: 'WhatsApp Bot API Documentation'
        }));
        
        // Create authentication middleware
        const authMiddleware = createAuthMiddleware(this.env);
        
        // Setup routes with controllers and authentication
        this.app.use('/api/whatsapp', authMiddleware.authenticate, createWhatsAppRoutes(this.whatsappController));
        
        // API routes with authentication
        this.app.use('/api', authMiddleware.authenticate, createApiRoutes(this.apiController));
        
        // Legacy routes for backward compatibility
        this.app.get('/health', (req, res) => this.apiController.healthCheck(req, res));
        this.app.get('/test', (req, res) => this.apiController.testClient(req, res));
        this.app.get('/qr', (req, res) => this.apiController.getQRCode(req, res));
        this.app.get('/qr/status', (req, res) => this.apiController.getQRStatus(req, res));
        this.app.get('/bot/status', (req, res) => this.apiController.getBotStatus(req, res));
        this.app.post('/bot/disconnect', (req, res) => this.apiController.disconnectClient(req, res));
        this.app.get('/mongodb/status', (req, res) => this.apiController.getMongoDBStatus(req, res));
        this.app.get('/mongodb/debug', (req, res) => this.apiController.debugMongoDB(req, res));
    }

    private setupMessageHandling(): void {
        // Register message handler with WhatsApp service
        this.whatsappService.addMessageHandler(async (clientId: string, message: any) => {
            await this.messageHandler.handleIncomingMessage(clientId, message);
        });
    }

    private setupMemoryOptimization(): void {
        // Set Node.js memory limits
        if (global.gc) {
            // Force garbage collection every 5 minutes
            setInterval(() => {
                try {
                    global.gc!();
                    console.log('🧹 Forced garbage collection completed');
                } catch (error) {
                    console.warn('⚠️ Garbage collection failed:', error);
                }
            }, 300000); // 5 minutes
        }

        // Memory monitoring
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const memUsageMB = {
                rss: Math.round(memUsage.rss / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024)
            };
            
            console.log(`📊 Memory Usage: RSS=${memUsageMB.rss}MB, Heap=${memUsageMB.heapUsed}/${memUsageMB.heapTotal}MB, External=${memUsageMB.external}MB`);
            
            // Alert if memory usage is high
            if (memUsageMB.heapUsed > 400) { // 400MB threshold
                console.warn(`⚠️ High memory usage detected: ${memUsageMB.heapUsed}MB`);
                if (global.gc) {
                    global.gc!();
                    console.log('🧹 Emergency garbage collection triggered');
                }
            }
        }, 60000); // Every minute

        console.log('🔧 Memory optimization and monitoring enabled');
    }

    public async initialize(): Promise<void> {
        try {
            console.log('🔗 Initializing WhatsApp Bot Application...');
            
            // Initialize WhatsApp service (connects to MongoDB and starts health checks)
            await this.whatsappService.initialize();
            console.log('✅ WhatsApp service initialized');
            
            // Restore existing sessions from MongoDB
            await this.whatsappService.restoreExistingSessions();
            console.log('✅ Existing sessions restored');
            
            
            console.log('🚀 WhatsApp Bot API ready - existing sessions restored, new clients can be created via API endpoints');
            
        } catch (error) {
            console.error('❌ Failed to initialize WhatsApp Bot Application:', error);
            throw error;
        }
    }

    public async start(port: number): Promise<void> {
        try {
            await this.initialize();
            
            this.app.listen(port, () => {
                console.log(`🌐 WhatsApp Bot API server running on port ${port}`);
                console.log(`📱 Health check: http://localhost:${port}/health`);
                console.log(`🔧 API endpoints: http://localhost:${port}/api/whatsapp/*`);
                console.log(`📚 API Documentation: http://localhost:${port}/documentation`);
            });
            
        } catch (error) {
            console.error('❌ Failed to start WhatsApp Bot Application:', error);
            throw error;
        }
    }

    public async gracefulShutdown(): Promise<void> {
        try {
            console.log('🛑 Shutting down WhatsApp Bot Application...');
            
            // Cleanup message handler
            this.messageHandler.cleanup();
            
            // Graceful shutdown of WhatsApp service
            await this.whatsappService.gracefulShutdown();
            
            console.log('✅ WhatsApp Bot Application shutdown complete');
            
        } catch (error) {
            console.error('❌ Error during graceful shutdown:', error);
        }
    }

    public getApp(): Express {
        return this.app;
    }
}