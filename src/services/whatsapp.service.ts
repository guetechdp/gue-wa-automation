import { WhatsAppClientManager } from '../client-manager';
import { Message } from 'whatsapp-web.js';
import { WhatsAppServiceConfig } from '../types';
import mongoose, { Document, Schema } from 'mongoose';

// Client-Agent Assignment Model
interface IClientAgent extends Document {
    clientId: string;
    ai_agent_code: string;
    assignedAt: Date;
    updatedAt: Date;
    isActive: boolean;
}

// Create model with error handling to avoid overwrite issues
let ClientAgent: mongoose.Model<IClientAgent>;
try {
    ClientAgent = mongoose.model<IClientAgent>('ClientAgent');
} catch (error) {
    const ClientAgentSchema = new Schema<IClientAgent>({
        clientId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        ai_agent_code: {
            type: String,
            required: true,
            index: true
        },
        assignedAt: {
            type: Date,
            default: Date.now
        },
        updatedAt: {
            type: Date,
            default: Date.now
        },
        isActive: {
            type: Boolean,
            default: true
        }
    }, {
        timestamps: true
    });

    // Update the updatedAt field before saving
    ClientAgentSchema.pre('save', function(next) {
        this.updatedAt = new Date();
        next();
    });

    // Create indexes for better performance
    ClientAgentSchema.index({ clientId: 1, isActive: 1 });
    ClientAgentSchema.index({ ai_agent_code: 1, isActive: 1 });

    ClientAgent = mongoose.model<IClientAgent>('ClientAgent', ClientAgentSchema);
}

export class WhatsAppService {
    public clientManager: WhatsAppClientManager;
    private messageHandlers: ((clientId: string, message: Message) => Promise<void>)[] = [];

    constructor(config: WhatsAppServiceConfig) {
        this.clientManager = new WhatsAppClientManager(config);
    }

    async initialize(): Promise<void> {
        await this.clientManager.initialize();
    }

    async gracefulShutdown(): Promise<void> {
        await this.clientManager.gracefulShutdown();
    }

    // Client Management
    async createClient(clientId: string) {
        return await this.clientManager.createClient(clientId);
    }

    async disconnectClient(clientId: string) {
        return await this.clientManager.disconnectClient(clientId);
    }

    async removeClient(clientId: string) {
        return await this.clientManager.removeClient(clientId);
    }

    async recoverErrorClient(clientId: string) {
        return await this.clientManager.recoverErrorClient(clientId);
    }

    getClient(clientId: string) {
        return this.clientManager.getClient(clientId);
    }

    getAllClients() {
        return this.clientManager.getAllClients();
    }

    getClientStatus(clientId: string) {
        return this.clientManager.getClientStatus(clientId);
    }

    // Message Handling
    addMessageHandler(handler: (clientId: string, message: Message) => Promise<void>) {
        this.messageHandlers.push(handler);
        this.clientManager.addMessageHandler(handler);
    }

    async sendMessage(clientId: string, number: string, message: string) {
        return await this.clientManager.sendMessage(clientId, number, message);
    }

    // Session Management
    async restoreExistingSessions() {
        return await this.clientManager.restoreExistingSessions();
    }

    // Health and Status
    isHealthy() {
        return this.clientManager.getAllClients().every(client => 
            client.status === 'ready' || client.status === 'qr_required'
        );
    }

    getHealthStatus() {
        const clients = this.clientManager.getAllClients();
        return {
            totalClients: clients.length,
            readyClients: clients.filter(c => c.status === 'ready').length,
            errorClients: clients.filter(c => c.status === 'error').length,
            isHealthy: this.isHealthy(),
            clients: clients.map(client => ({
                clientId: client.clientId,
                status: client.status,
                isReady: client.isReady,
                phoneNumber: client.phoneNumber,
                hasQrCode: !!client.qrCode,
                lastActivity: client.lastActivity ? client.lastActivity.toISOString() : null
            }))
        };
    }

    // Reset client to QR scanning (fallback for corrupted sessions)
    async resetClientToQRScanning(clientId: string): Promise<void> {
        return this.clientManager.resetClientToQRScanning(clientId);
    }

    // Client-Agent Assignment Management
    async assignAgentToClient(clientId: string, ai_agent_code: string): Promise<{ success: boolean; message: string; assignment?: any }> {
        try {
            // Validate client exists and is ready
            const clientInfo = this.getClient(clientId);
            if (!clientInfo) {
                return {
                    success: false,
                    message: `Client ${clientId} not found`
                };
            }

            if (clientInfo.status !== 'ready' || !clientInfo.isReady) {
                return {
                    success: false,
                    message: `Client ${clientId} must be in 'ready' status to assign an agent. Current status: ${clientInfo.status}`
                };
            }

            // Check if client already has an agent assigned
            const existingAssignment = await ClientAgent.findOne({ 
                clientId: clientId, 
                isActive: true 
            });

            if (existingAssignment) {
                // Update existing assignment
                existingAssignment.ai_agent_code = ai_agent_code;
                existingAssignment.updatedAt = new Date();
                await existingAssignment.save();

                // Update client info in memory
                clientInfo.ai_agent_code = ai_agent_code;

                console.log(`🤖 Updated agent assignment for client ${clientId}: ${ai_agent_code}`);

                return {
                    success: true,
                    message: `Agent code updated for client ${clientId}`,
                    assignment: {
                        clientId: existingAssignment.clientId,
                        ai_agent_code: existingAssignment.ai_agent_code,
                        assignedAt: existingAssignment.assignedAt,
                        updatedAt: existingAssignment.updatedAt
                    }
                };
            } else {
                // Create new assignment
                const newAssignment = new ClientAgent({
                    clientId: clientId,
                    ai_agent_code: ai_agent_code,
                    assignedAt: new Date(),
                    updatedAt: new Date(),
                    isActive: true
                });

                await newAssignment.save();

                // Update client info in memory
                clientInfo.ai_agent_code = ai_agent_code;

                console.log(`🤖 Created new agent assignment for client ${clientId}: ${ai_agent_code}`);

                return {
                    success: true,
                    message: `Agent code assigned to client ${clientId}`,
                    assignment: {
                        clientId: newAssignment.clientId,
                        ai_agent_code: newAssignment.ai_agent_code,
                        assignedAt: newAssignment.assignedAt,
                        updatedAt: newAssignment.updatedAt
                    }
                };
            }
        } catch (error) {
            console.error(`❌ Error assigning agent to client ${clientId}:`, error);
            return {
                success: false,
                message: `Failed to assign agent to client ${clientId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async removeAgentFromClient(clientId: string): Promise<{ success: boolean; message: string }> {
        try {
            // Validate client exists
            const clientInfo = this.getClient(clientId);
            if (!clientInfo) {
                return {
                    success: false,
                    message: `Client ${clientId} not found`
                };
            }

            // Find and deactivate assignment
            const assignment = await ClientAgent.findOne({ 
                clientId: clientId, 
                isActive: true 
            });

            if (!assignment) {
                return {
                    success: false,
                    message: `No active agent assignment found for client ${clientId}`
                };
            }

            // Deactivate assignment
            assignment.isActive = false;
            assignment.updatedAt = new Date();
            await assignment.save();

            // Remove agent code from client info in memory
            clientInfo.ai_agent_code = undefined;

            console.log(`🤖 Removed agent assignment for client ${clientId}`);

            return {
                success: true,
                message: `Agent assignment removed from client ${clientId}`
            };
        } catch (error) {
            console.error(`❌ Error removing agent from client ${clientId}:`, error);
            return {
                success: false,
                message: `Failed to remove agent from client ${clientId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async getClientAgentAssignment(clientId: string): Promise<{ success: boolean; assignment?: any; message?: string }> {
        try {
            const assignment = await ClientAgent.findOne({ 
                clientId: clientId, 
                isActive: true 
            });

            if (!assignment) {
                return {
                    success: true,
                    message: `No active agent assignment found for client ${clientId}`
                };
            }

            return {
                success: true,
                assignment: {
                    clientId: assignment.clientId,
                    ai_agent_code: assignment.ai_agent_code,
                    assignedAt: assignment.assignedAt,
                    updatedAt: assignment.updatedAt
                }
            };
        } catch (error) {
            console.error(`❌ Error getting agent assignment for client ${clientId}:`, error);
            return {
                success: false,
                message: `Failed to get agent assignment for client ${clientId}: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    async getAllAgentAssignments(): Promise<{ success: boolean; assignments: any[]; message?: string }> {
        try {
            const assignments = await ClientAgent.find({ isActive: true })
                .sort({ updatedAt: -1 });

            return {
                success: true,
                assignments: assignments.map(assignment => ({
                    clientId: assignment.clientId,
                    ai_agent_code: assignment.ai_agent_code,
                    assignedAt: assignment.assignedAt,
                    updatedAt: assignment.updatedAt
                }))
            };
        } catch (error) {
            console.error(`❌ Error getting all agent assignments:`, error);
            return {
                success: false,
                assignments: [],
                message: `Failed to get agent assignments: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
}