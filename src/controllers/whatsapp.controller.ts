import { Request, Response } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';

export class WhatsAppController {
    constructor(private whatsappService: WhatsAppService) {}

    // Client Management
    async createClient(req: Request, res: Response) {
        try {
            const { clientId } = req.body;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const clientInfo = await this.whatsappService.createClient(clientId);
            
            // Return clean client data without circular references
            const cleanClient = {
                clientId: clientInfo.clientId,
                status: clientInfo.status,
                isReady: clientInfo.isReady,
                phoneNumber: clientInfo.phoneNumber,
                hasQrCode: !!clientInfo.qrCode,
                lastActivity: clientInfo.lastActivity ? clientInfo.lastActivity.toISOString() : null
            };
            
            return res.status(201).json({
                success: true,
                message: `Client ${clientId} created successfully`,
                client: cleanClient
            });
            
        } catch (error) {
            console.error('❌ Error creating client:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async getAllClients(req: Request, res: Response) {
        try {
            const clients = this.whatsappService.getAllClients();
            
            // Return clean client data without circular references
            const cleanClients = clients.map(client => ({
                clientId: client.clientId,
                status: client.status,
                isReady: client.isReady,
                phoneNumber: client.phoneNumber,
                hasQrCode: !!client.qrCode,
                lastActivity: client.lastActivity ? client.lastActivity.toISOString() : null
            }));
            
            return res.status(200).json({
                success: true,
                clients: cleanClients,
                total: clients.length
            });
            
        } catch (error) {
            console.error('❌ Error getting clients:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async getClientStatus(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const clientInfo = this.whatsappService.getClient(clientId);
            if (!clientInfo) {
                return res.status(404).json({
                    success: false,
                    error: `Client ${clientId} not found`
                });
            }

            // Return clean client data without circular references
            const cleanClient = {
                clientId: clientInfo.clientId,
                status: clientInfo.status,
                isReady: clientInfo.isReady,
                phoneNumber: clientInfo.phoneNumber,
                hasQrCode: !!clientInfo.qrCode,
                qrCode: clientInfo.qrCode || null,
                lastActivity: clientInfo.lastActivity ? clientInfo.lastActivity.toISOString() : null
            };
            
            return res.status(200).json({
                success: true,
                client: cleanClient
            });
            
        } catch (error) {
            console.error('❌ Error getting client status:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async disconnectClient(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            await this.whatsappService.disconnectClient(clientId);
            
            return res.status(200).json({
                success: true,
                message: `Client ${clientId} disconnected successfully`
            });
            
        } catch (error) {
            console.error('❌ Error disconnecting client:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async removeClient(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            await this.whatsappService.removeClient(clientId);
            
            return res.status(200).json({
                success: true,
                message: `Client ${clientId} removed successfully`
            });
            
        } catch (error) {
            console.error('❌ Error removing client:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async recoverClient(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const clientInfo = this.whatsappService.getClient(clientId);
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

            const { forceReset } = req.body; // New parameter to force reset to QR scanning
            
            if (forceReset) {
                console.log(`🔄 Force reset to QR scanning requested for client ${clientId}`);
                await this.whatsappService.resetClientToQRScanning(clientId);
                return res.status(200).json({
                    success: true,
                    message: `Client ${clientId} reset to QR scanning mode successfully`,
                    clientId: clientId
                });
            } else {
                console.log(`🔄 Manual recovery requested for client ${clientId}`);
                await this.whatsappService.recoverErrorClient(clientId);
                return res.status(200).json({
                    success: true,
                    message: `Recovery initiated for client ${clientId}`,
                    clientId: clientId
                });
            }
            
        } catch (error) {
            console.error(`❌ Error recovering client ${req.params.clientId}:`, error);
            return res.status(500).json({
                success: false,
                error: `Failed to recover client ${req.params.clientId}`
            });
        }
    }

    // Send Message
    async sendMessage(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            const { number, message } = req.body;
            
            if (!clientId) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'clientId parameter is required' 
                });
            }
            
            if (!number || !message) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Number and message are required' 
                });
            }
            
            const clientInfo = this.whatsappService.getClient(clientId);
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
            
            await this.whatsappService.sendMessage(clientId, number, message);
            
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
    }

    // QR Code Management
    async getQRCode(req: Request, res: Response) {
        try {
            const clients = this.whatsappService.getAllClients();
            
            if (clients.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No clients available'
                });
            }

            const firstClient = clients[0];
            if (!firstClient) {
                return res.status(404).json({
                    success: false,
                    error: 'No valid client found'
                });
            }

            if (firstClient.status === 'qr_required' && firstClient.qrCode) {
                return res.status(200).json({
                    success: true,
                    qrCode: firstClient.qrCode,
                    clientId: firstClient.clientId
                });
            } else {
                return res.status(404).json({
                    success: false,
                    error: 'No QR code available'
                });
            }
            
        } catch (error) {
            console.error('❌ Error getting QR code:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    async refreshQRCode(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const clientInfo = this.whatsappService.getClient(clientId);
            if (!clientInfo) {
                return res.status(404).json({
                    success: false,
                    error: `Client ${clientId} not found`
                });
            }

            if (clientInfo.status !== 'qr_required') {
                return res.status(400).json({
                    success: false,
                    error: `Client ${clientId} is not in QR required status (current status: ${clientInfo.status})`
                });
            }

            // Force QR code refresh by disconnecting and reconnecting
            await this.whatsappService.disconnectClient(clientId);
            await this.whatsappService.createClient(clientId);
            
            return res.status(200).json({
                success: true,
                message: `QR code refresh initiated for client ${clientId}`
            });
            
        } catch (error) {
            console.error(`❌ Error refreshing QR code for client ${req.params.clientId}:`, error);
            return res.status(500).json({
                success: false,
                error: `Failed to refresh QR code for client ${req.params.clientId}`
            });
        }
    }

    // Get QR code as image (direct browser rendering)
    async getQRImage(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const clientInfo = this.whatsappService.getClient(clientId);
            if (!clientInfo) {
                return res.status(404).json({
                    success: false,
                    error: `Client ${clientId} not found`
                });
            }

            if (!clientInfo.qrCode) {
                return res.status(404).json({
                    success: false,
                    error: `No QR code available for client ${clientId}. Status: ${clientInfo.status}`
                });
            }

            // Set headers for image response
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            
            // Convert base64 to buffer and send
            const imageBuffer = Buffer.from(clientInfo.qrCode, 'base64');
            return res.send(imageBuffer);
            
        } catch (error) {
            console.error(`❌ Error getting QR image for client ${req.params.clientId}:`, error);
            return res.status(500).json({
                success: false,
                error: `Failed to get QR image for client ${req.params.clientId}`
            });
        }
    }

    // Fallback to QR scanning (for corrupted sessions)
    async resetToQRScanning(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            console.log(`🔄 Manual fallback to QR scanning requested for client: ${clientId}`);
            
            // Trigger the fallback mechanism
            await this.whatsappService.resetClientToQRScanning(clientId);
            
            return res.status(200).json({
                success: true,
                message: `Client ${clientId} reset to QR scanning mode successfully`,
                clientId: clientId
            });
            
        } catch (error) {
            console.error('❌ Error resetting client to QR scanning:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    // Health and Status
    async getHealthStatus(req: Request, res: Response) {
        try {
            const healthStatus = this.whatsappService.getHealthStatus();
            
            return res.status(200).json({
                success: true,
                health: healthStatus
            });
            
        } catch (error) {
            console.error('❌ Error getting health status:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
