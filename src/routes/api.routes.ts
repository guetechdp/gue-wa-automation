import { Router } from 'express';
import { ApiController } from '../controllers/api.controller';

export function createApiRoutes(apiController: ApiController): Router {
    const router = Router();

    // Health and Status Routes
    router.get('/health', (req, res) => apiController.healthCheck(req, res));

    // Test Routes
    router.get('/test-client', (req, res) => apiController.testClient(req, res));
    router.post('/test-send', (req, res) => apiController.testSendMessage(req, res));
    router.get('/test-events', (req, res) => apiController.testEvents(req, res));
    router.post('/test-ai-api', (req, res) => apiController.testAIApi(req, res));

    // Bot Status Routes
    router.get('/bot/status', (req, res) => apiController.getBotStatus(req, res));
    router.post('/bot/disconnect', (req, res) => apiController.disconnectClient(req, res));
    router.post('/greetings', (req, res) => apiController.sendGreeting(req, res));

    // QR Code Routes (legacy compatibility)
    router.get('/qr', (req, res) => apiController.getQRCode(req, res));
    router.get('/qr/status', (req, res) => apiController.getQRStatus(req, res));

    // MongoDB Routes
    router.get('/mongodb/status', (req, res) => apiController.getMongoDBStatus(req, res));
    router.get('/mongodb/debug', (req, res) => apiController.debugMongoDB(req, res));

    return router;
}