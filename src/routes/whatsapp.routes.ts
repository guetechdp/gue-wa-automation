import { Router } from 'express';
import { WhatsAppController } from '../controllers/whatsapp.controller';

export function createWhatsAppRoutes(whatsappController: WhatsAppController): Router {
    const router = Router();

    // Client Management Routes
    router.post('/clients', (req, res) => whatsappController.createClient(req, res));
    router.get('/clients', (req, res) => whatsappController.getAllClients(req, res));
    
    // Specific routes must come before general ones
    router.get('/clients/:clientId/qr-image', (req, res) => whatsappController.getQRImage(req, res));
    router.post('/clients/:clientId/send', (req, res) => whatsappController.sendMessage(req, res));
    router.post('/clients/:clientId/disconnect', (req, res) => whatsappController.disconnectClient(req, res));
    router.delete('/clients/:clientId', (req, res) => whatsappController.removeClient(req, res));
    router.post('/clients/:clientId/recover', (req, res) => whatsappController.recoverClient(req, res));
    router.post('/clients/:clientId/reset-to-qr', (req, res) => whatsappController.resetToQRScanning(req, res));
    router.get('/clients/:clientId', (req, res) => whatsappController.getClientStatus(req, res));

    // QR Code Management Routes
    router.get('/qr', (req, res) => whatsappController.getQRCode(req, res));
    router.post('/qr/:clientId/refresh', (req, res) => whatsappController.refreshQRCode(req, res));

    // Health and Status Routes
    router.get('/health', (req, res) => whatsappController.getHealthStatus(req, res));

    return router;
}
