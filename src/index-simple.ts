import express, { Request, Response } from 'express';
import { Client, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Simple WhatsApp client following official documentation
const client = new Client({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// QR Code event
client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.generate(qr, { small: true });
});

// Ready event
client.on('ready', () => {
    console.log('Client is ready!');
});

// Message event - following official documentation exactly
client.on('message', msg => {
    console.log('MESSAGE RECEIVED:', msg.from, msg.body);
    
    if (msg.body == '!ping') {
        msg.reply('pong');
        console.log('Replied with pong');
    }
});

// Initialize client
client.initialize();

// Simple Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ message: 'WhatsApp Bot is running' });
});
