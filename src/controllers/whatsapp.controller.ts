import { Request, Response } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';

export class WhatsAppController {
    constructor(private whatsappService: WhatsAppService) {}

    /**
     * @swagger
     * /api/whatsapp/clients:
     *   post:
     *     summary: Create a new WhatsApp client
     *     description: Creates a new WhatsApp client with the specified client ID. The client will generate a QR code for authentication.
     *     tags: [Client Management]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/CreateClientRequest'
     *     responses:
     *       201:
     *         description: Client created successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Client javear-account created successfully"
     *                 client:
     *                   $ref: '#/components/schemas/ClientInfo'
     *       400:
     *         description: Bad request - Client ID is required
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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

    /**
     * @swagger
     * /api/whatsapp/clients:
     *   get:
     *     summary: Get all WhatsApp clients
     *     description: Retrieves a list of all WhatsApp clients and their current status
     *     tags: [Client Management]
     *     responses:
     *       200:
     *         description: List of clients retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 clients:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/ClientInfo'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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
                lastActivity: client.lastActivity ? client.lastActivity.toISOString() : null,
                ai_agent_code: client.ai_agent_code || null
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

    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}:
     *   get:
     *     summary: Get client status
     *     description: Retrieves the current status and information for a specific WhatsApp client
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     responses:
     *       200:
     *         description: Client status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 client:
     *                   $ref: '#/components/schemas/ClientInfo'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}:
     *   get:
     *     summary: Get client status
     *     description: Retrieves detailed status information for a specific WhatsApp client
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *     responses:
     *       200:
     *         description: Client status retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 client:
     *                   $ref: '#/components/schemas/ClientInfo'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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
                lastActivity: clientInfo.lastActivity ? clientInfo.lastActivity.toISOString() : null,
                ai_agent_code: clientInfo.ai_agent_code || null
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

    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/disconnect:
     *   post:
     *     summary: Disconnect WhatsApp client
     *     description: Disconnects a WhatsApp client from the system
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *     responses:
     *       200:
     *         description: Client disconnected successfully
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SuccessResponse'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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

    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}:
     *   delete:
     *     summary: Remove WhatsApp client completely
     *     description: Permanently removes a WhatsApp client from the system. This will disconnect the client, remove it from memory, and delete all associated session data from MongoDB. This action cannot be undone.
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client to remove
     *         example: "my-whatsapp-client"
     *     security:
     *       - bearerAuth: []
     *     responses:
     *       200:
     *         description: Client removed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Client my-whatsapp-client removed successfully"
     *       400:
     *         description: Bad request - Client ID is required
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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
    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/send:
     *   post:
     *     summary: Send a message via WhatsApp client
     *     description: Sends a text message to a specific phone number using the specified WhatsApp client
     *     tags: [Message Operations]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             $ref: '#/components/schemas/SendMessageRequest'
     *     responses:
     *       200:
     *         description: Message sent successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Message sent successfully"
     *                 clientId:
     *                   type: string
     *                   example: "javear-account"
     *                 to:
     *                   type: string
     *                   example: "6281234567890"
     *       400:
     *         description: Bad request - Missing required fields or client not ready
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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
    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/qr-image:
     *   get:
     *     summary: Get QR code image
     *     description: Retrieves the QR code as a PNG image for the specified WhatsApp client. Returns the image directly in the response.
     *     tags: [QR Code Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     responses:
     *       200:
     *         description: QR code image returned successfully
     *         content:
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     *       404:
     *         description: Client not found or no QR code available
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
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

    // Client-Agent Assignment Management
    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/agent:
     *   put:
     *     summary: Assign or update agent for client
     *     description: Assigns an AI agent code to a WhatsApp client. The client must be in 'ready' status to assign an agent.
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - ai_agent_code
     *             properties:
     *               ai_agent_code:
     *                 type: string
     *                 description: The AI agent code to assign to the client
     *                 example: "FW001"
     *     responses:
     *       200:
     *         description: Agent assigned successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Agent code assigned to client javear-account"
     *                 assignment:
     *                   type: object
     *                   properties:
     *                     clientId:
     *                       type: string
     *                       example: "javear-account"
     *                     ai_agent_code:
     *                       type: string
     *                       example: "FW001"
     *                     assignedAt:
     *                       type: string
     *                       format: date-time
     *                     updatedAt:
     *                       type: string
     *                       format: date-time
     *       400:
     *         description: Bad request - Client not ready or missing agent code
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async updateClientAgent(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            const { ai_agent_code } = req.body;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            if (!ai_agent_code) {
                return res.status(400).json({
                    success: false,
                    error: 'ai_agent_code is required'
                });
            }

            const result = await this.whatsappService.assignAgentToClient(clientId, ai_agent_code);
            
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.message
                });
            }
            
            return res.status(200).json({
                success: true,
                message: result.message,
                assignment: result.assignment
            });
            
        } catch (error) {
            console.error('❌ Error updating client agent:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/agent:
     *   delete:
     *     summary: Remove agent from client
     *     description: Removes the AI agent assignment from a WhatsApp client
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     responses:
     *       200:
     *         description: Agent removed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 message:
     *                   type: string
     *                   example: "Agent assignment removed from client javear-account"
     *       400:
     *         description: Bad request - No agent assignment found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async removeClientAgent(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const result = await this.whatsappService.removeAgentFromClient(clientId);
            
            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.message
                });
            }
            
            return res.status(200).json({
                success: true,
                message: result.message
            });
            
        } catch (error) {
            console.error('❌ Error removing client agent:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * @swagger
     * /api/whatsapp/clients/{clientId}/agent:
     *   get:
     *     summary: Get client agent assignment
     *     description: Retrieves the AI agent assignment for a specific WhatsApp client
     *     tags: [Client Management]
     *     parameters:
     *       - in: path
     *         name: clientId
     *         required: true
     *         schema:
     *           type: string
     *         description: The unique identifier of the WhatsApp client
     *         example: "javear-account"
     *     responses:
     *       200:
     *         description: Agent assignment retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 assignment:
     *                   type: object
     *                   properties:
     *                     clientId:
     *                       type: string
     *                       example: "javear-account"
     *                     ai_agent_code:
     *                       type: string
     *                       example: "FW001"
     *                     assignedAt:
     *                       type: string
     *                       format: date-time
     *                     updatedAt:
     *                       type: string
     *                       format: date-time
     *                 message:
     *                   type: string
     *                   example: "No active agent assignment found for client javear-account"
     *       404:
     *         description: Client not found
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async getClientAgent(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            
            if (!clientId) {
                return res.status(400).json({
                    success: false,
                    error: 'Client ID is required'
                });
            }

            const result = await this.whatsappService.getClientAgentAssignment(clientId);
            
            return res.status(200).json({
                success: true,
                assignment: result.assignment,
                message: result.message
            });
            
        } catch (error) {
            console.error('❌ Error getting client agent:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * @swagger
     * /api/whatsapp/agents:
     *   get:
     *     summary: Get all agent assignments
     *     description: Retrieves all active AI agent assignments across all WhatsApp clients
     *     tags: [Client Management]
     *     responses:
     *       200:
     *         description: Agent assignments retrieved successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 assignments:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       clientId:
     *                         type: string
     *                         example: "javear-account"
     *                       ai_agent_code:
     *                         type: string
     *                         example: "FW001"
     *                       assignedAt:
     *                         type: string
     *                         format: date-time
     *                       updatedAt:
     *                         type: string
     *                         format: date-time
     *                 total:
     *                   type: number
     *                   example: 1
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/ErrorResponse'
     */
    async getAllAgentAssignments(req: Request, res: Response) {
        try {
            const result = await this.whatsappService.getAllAgentAssignments();
            
            return res.status(200).json({
                success: true,
                assignments: result.assignments,
                total: result.assignments.length,
                message: result.message
            });
            
        } catch (error) {
            console.error('❌ Error getting all agent assignments:', error);
            return res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}
