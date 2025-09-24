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
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--hide-scrollbars',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-first-run',
                '--safebrowsing-disable-auto-update',
                '--ignore-ssl-errors',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--ignore-certificate-errors-spki-list',
                '--ignore-ssl-errors',
                '--allow-running-insecure-content',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor'
            ],
            mongoUri: env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-bot',
            backupSyncIntervalMs: 300000, // 5 minutes
            maxRetries: 5,
            retryDelayMs: 2000,
            healthCheckIntervalMs: 30000
        };
        
        // Initialize services
        this.whatsappService = new WhatsAppService(whatsappConfig);
        this.messageHandler = new MessageHandler(this.whatsappService, env);
        this.whatsappController = new WhatsAppController(this.whatsappService);
        this.apiController = new ApiController(this.whatsappService, env);
        
        this.setupRoutes();
        this.setupMessageHandling();
    }

    private setupRoutes(): void {
        // Setup Swagger documentation with Monokai theme
        let monokaiCSS = '';
        try {
            monokaiCSS = fs.readFileSync('public/css/theme-monokai.css', 'utf8');
        } catch (error) {
            console.warn('⚠️ Monokai CSS file not found, using default Swagger theme');
        }
        
        // Setup Swagger UI with proper static asset serving
        this.app.use('/documentation', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
            explorer: true,
            swaggerOptions: {
                docExpansion: 'list',
                defaultModelsExpandDepth: 2,
                defaultModelExpandDepth: 2,
                displayRequestDuration: true,
                filter: true,
                showExtensions: true,
                showCommonExtensions: true,
                tryItOutEnabled: true,
                operationsSorter: 'alpha',
                tagsSorter: 'alpha',
                deepLinking: true,
                showRequestHeaders: true
            },
            customCss: `
                .swagger-ui .topbar { display: none }
                .swagger-ui .opblock .opblock-summary { cursor: pointer; }
                .swagger-ui .opblock .opblock-summary:hover { background: #f7f7f7; }
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