import { WhatsAppClientManager } from '../client-manager';
import { Message } from 'whatsapp-web.js';
import { WhatsAppServiceConfig } from '../types';

export class WhatsAppService {
    private clientManager: WhatsAppClientManager;
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
}