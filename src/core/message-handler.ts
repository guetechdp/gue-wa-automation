import { Message, Chat, MessageMedia } from 'whatsapp-web.js';
import { WhatsAppService } from '../services/whatsapp.service';
import { Environment, ChatMessage } from '../types';
import axios from 'axios';
import jwt from 'jsonwebtoken';

export class MessageHandler {
    private messageQueue: { [senderNumber: string]: Array<{ message: Message; timestamp: number }> } = {};
    private processingUsers: { [senderNumber: string]: number } = {};
    private env: Environment;

    constructor(
        private whatsappService: WhatsAppService,
        env: Environment
    ) {
        this.env = env;
    }

    public async handleIncomingMessage(clientId: string, message: Message): Promise<void> {
        console.log(`📨 MESSAGE RECEIVED from client ${clientId}:`, message.from);
        console.log("📨 MESSAGE BODY:", message.body);
        console.log("📨 MESSAGE TIMESTAMP:", new Date().toISOString());
        
        // Simple test - just reply to any message
        if (message.body === '!ping') {
            try {
                await message.reply('pong');
                console.log("📨 Replied with pong");
            } catch (error) {
                console.error('❌ Error replying to ping:', error);
            }
            return;
        }
        
        // Check if the sender's number is in the allowed numbers list
        const senderNumberParts = message.from.split('@');
        const senderNumber: string = senderNumberParts[0] || '';
        
        console.log("📨 Sender number:", senderNumber);
        
        const productionMode = this.env.NODE_ENV === 'production';
        const allowedNumbers: string[] = [];
        
        if (!productionMode && this.env.WHITELISTED_NUMBERS) {
            allowedNumbers.push(...this.env.WHITELISTED_NUMBERS.split(','));
        }
        
        console.log("📨 Production mode:", productionMode);
        console.log("📨 Allowed numbers:", allowedNumbers);
        console.log("📨 Sender number:", senderNumber);
        
        if (productionMode) {
            console.log("📨 Processing message in production mode");
            await this.handleIncomingMessageWithQueue(clientId, senderNumber, message, 10000);
        } else {
            if (allowedNumbers.includes(senderNumber)) {
                console.log(`📨 Message from ${senderNumber} ignored (whitelisted).`);
            } else {
                console.log("📨 Processing message in development mode");
                await this.handleIncomingMessageWithQueue(clientId, senderNumber, message, 10000);
            }
        }
    }

    private async handleIncomingMessageWithQueue(clientId: string, sender: string, message: Message, delay: number = 10000): Promise<void> {
        console.log(`🔄 handleIncomingMessage called for ${sender} with delay ${delay}ms`);
        const senderNumber: string = sender;
        
        // Check if this exact message was already processed recently
        const messageId = message.id._serialized;
        const recentProcessed = this.processingUsers[`${senderNumber}_${messageId}`];
        if (recentProcessed && (Date.now() - recentProcessed) < 5000) { // 5 second deduplication
            console.log(`Message ${messageId} from ${senderNumber} already processed recently, skipping`);
            return;
        }
        
        // Initialize message processing state for this user
        if (!this.messageQueue[senderNumber]) {
            this.messageQueue[senderNumber] = [];
        }
    
        // Add current message to queue
        this.messageQueue[senderNumber].push({
            message,
            timestamp: Date.now()
        });
    
        // Prepare chat for pre-reply actions
        let preReplyChat: Chat | null = null;
        try {
            preReplyChat = await message.getChat();
        } catch (e) {
            console.log('Could not prepare chat for pre-reply actions');
        }
        
        // Function to process all queued messages
        const processQueuedMessages = async () => {
            try {
                // Get all queued messages for this user
                const queuedMessages = this.messageQueue[senderNumber] || [];
                
                if (queuedMessages.length > 0) {
                    // Get the chat reference
                    const chatRef: Chat = preReplyChat || await message.getChat();
                    
                    // Combine all queued messages into one string, including quoted message context
                    const combinedUserMessages = await Promise.all(
                        queuedMessages.map(async (item) => {
                            let messageText = item.message.body;
                            
                            // Check if this message is a reply to another message
                            if (item.message.hasQuotedMsg) {
                                try {
                                    const quoted = await item.message.getQuotedMessage();
                                    if (quoted && quoted.body) {
                                        messageText = `Replying to this message: "${quoted.body}"\n${messageText}`;
                                        console.log(`📝 Enhanced message with quoted context: "${messageText}"`);
                                    }
                                } catch (error) {
                                    console.error('❌ Error getting quoted message:', error);
                                    // Continue with original message if quoted message retrieval fails
                                }
                            }
                            
                            return messageText;
                        })
                    );
                    
                    const finalCombinedMessages = combinedUserMessages.join('\n');
                    
                    // If we have user messages to process
                    if (finalCombinedMessages && finalCombinedMessages.trim()) {
                        console.log(`🔄 FINAL PROCESSING: ${queuedMessages.length} messages from ${senderNumber} after timer expired`);
                        console.log(`📝 Combined messages: "${finalCombinedMessages}"`);
                        await this.sendMessage(clientId, senderNumber, finalCombinedMessages, null, false, null);
                    } else {
                        console.log(`No valid messages to process for ${senderNumber}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing messages for ${senderNumber}:`, error);
            } finally {
                // Mark all processed messages as processed to prevent duplicates BEFORE cleanup
                const queuedMessages = this.messageQueue[senderNumber] || [];
                queuedMessages.forEach(item => {
                    const messageId = item.message.id._serialized;
                    this.processingUsers[`${senderNumber}_${messageId}`] = Date.now();
                });
                
                // Clean up
                delete this.messageQueue[senderNumber];
                delete this.processingUsers[senderNumber];
                delete (this.processingUsers as any)[`${senderNumber}_timer`];
                delete (this.processingUsers as any)[`${senderNumber}_readTypingTimer`];
                console.log(`🧹 Cleaned up processing state for ${senderNumber}`);
            }
        };
        
        // Function to schedule read and typing indicators
        const scheduleReadAndTyping = (chat: Chat, delayMs: number) => {
            // Clear any existing read/typing timer
            if ((this.processingUsers as any)[`${senderNumber}_readTypingTimer`]) {
                clearTimeout((this.processingUsers as any)[`${senderNumber}_readTypingTimer`]);
            }
            
            // Schedule read and typing at a random moment within the delay window
            const minPreDelay = Math.max(0, Math.floor(delayMs * 0.3));
            const maxPreDelay = Math.max(minPreDelay, Math.floor(delayMs * 0.8));
            const preDelayMs = minPreDelay + Math.floor(Math.random() * (maxPreDelay - minPreDelay + 1));
            
            const readTypingTimer = setTimeout(async () => {
                try {
                    await chat.sendSeen();
                    await chat.sendStateTyping();
                } catch {
                    // ignore
                }
            }, preDelayMs);
            
            (this.processingUsers as any)[`${senderNumber}_readTypingTimer`] = readTypingTimer;
        };
        
        // If user is already being processed, reset the timer to 10 seconds
        if (this.processingUsers[senderNumber]) {
            console.log(`⏰ Message from ${senderNumber} queued. Total queued: ${this.messageQueue[senderNumber].length}`);
            console.log(`🔄 Resetting timer to ${delay}ms for ${senderNumber}`);
            
            // Clear the existing timer and set a new one for 10 seconds
            if ((this.processingUsers as any)[`${senderNumber}_timer`]) {
                clearTimeout((this.processingUsers as any)[`${senderNumber}_timer`]);
                console.log(`⏰ Cleared previous timer for ${senderNumber}`);
            }
            
            // Reschedule read and typing indicators for the new delay
            if (preReplyChat) {
                scheduleReadAndTyping(preReplyChat, delay);
            }
            
            // Set new timer for 10 seconds (not extending, but resetting)
            const newTimer = setTimeout(async () => {
                console.log(`⏰ Timer expired for ${senderNumber}, processing queued messages...`);
                await processQueuedMessages();
            }, delay);
            
            (this.processingUsers as any)[`${senderNumber}_timer`] = newTimer;
            console.log(`⏰ New timer set for ${senderNumber} (${delay}ms)`);
            return;
        }
        
        // Mark user as being processed with timestamp
        this.processingUsers[senderNumber] = Date.now();
        console.log(`🚀 Starting initial processing for ${senderNumber}`);
        
        // Schedule read and typing indicators for the initial delay
        if (preReplyChat) {
            scheduleReadAndTyping(preReplyChat, delay);
        }
        
        // Set initial timer for 10 seconds
        const timer = setTimeout(async () => {
            console.log(`⏰ Initial timer expired for ${senderNumber}, processing queued messages...`);
            await processQueuedMessages();
        }, delay);
        
        // Store the timer reference
        (this.processingUsers as any)[`${senderNumber}_timer`] = timer;
        console.log(`⏰ Initial timer set for ${senderNumber} (${delay}ms)`);
    }

    // Convert generic LLM Markdown/HTML to WhatsApp-friendly formatting
    private convertLLMToWhatsApp(content: string, preserveStructure: boolean = true): string {
        try {
            const originalLength = content.length;
            let formattedContent = content.replace(/\r\n/g, '\n');

            // Tokenize code regions to avoid accidental formatting inside code
            const codeBlocks: string[] = [];
            const inlineCodes: string[] = [];
            formattedContent = formattedContent.replace(/```([\s\S]*?)```/g, (_m, p1) => {
                const token = `__CODEBLOCK_${codeBlocks.length}__`;
                codeBlocks.push(String(p1));
                return token;
            });
            formattedContent = formattedContent.replace(/`([^`\n]+)`/g, (_m, p1) => {
                const token = `__INLINECODE_${inlineCodes.length}__`;
                inlineCodes.push(String(p1));
                return token;
            });

            // Markdown links → plain text with URL to ensure clickability in WhatsApp
            formattedContent = formattedContent.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)');

            // Unescape already-escaped formatting sequences
            formattedContent = formattedContent
                .replace(/\\\\_([^_]+)\\\\_/g, '_$1_')
                .replace(/\\\\\*([^*]+)\\\\\*/g, '*$1*')
                .replace(/\\\\~([^~]+)\\\\~/g, '~$1~')
                .replace(/\\\\`([^`]+)\\\\`/g, '```$1```');

            // Bullets: •, -, * at line-start → '* '
            // Protect bullet markers using a neutral sentinel that won't collide with formatting rules
            formattedContent = formattedContent
                .replace(/^[\t ]*[•]\s+/gm, '§BULLET§ ')
                .replace(/^[\t ]*[-*]\s+/gm, '§BULLET§ ');

            // Numbered lists: 1) → 1.
            formattedContent = formattedContent
                .replace(/^[\t ]*(\d+)\)\s+/gm, '$1. ')
                .replace(/^[\t ]*(\d+)\.\s+/gm, '$1. ');

            // Bold: **text** or __text__ → *text*
            formattedContent = formattedContent
                .replace(/\*\*(.+?)\*\*/g, '*$1*')
                .replace(/__(.+?)__/g, '*$1*')
                .replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*')
                .replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*');

            // Italic: single-asterisk or underscores → _text_
            // - Do not convert list bullets '* ' (handled via sentinel)
            // - Do not convert bold '**...**' (handled above)
            // - Avoid snake_case by requiring non-word boundaries
            formattedContent = formattedContent
                .replace(/(^|[^\w*])\*(?!\*)([^\s*][^*]*?[^\s*])\*(?!\*)/g, '$1_$2_')
                .replace(/(^|[^\w])_(?!_)([^_\n]+?)_(?=[^\w]|$)/g, '$1_$2_')
                .replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_')
                .replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_');

            // Strikethrough: ~~text~~ or <s>/<strike> → ~text~
            formattedContent = formattedContent
                .replace(/~~([\s\S]*?)~~/g, '~$1~')
                .replace(/<s>([\s\S]*?)<\/s>/gi, '~$1~')
                .replace(/<strike>([\s\S]*?)<\/strike>/gi, '~$1~');

            // Headers (# ...) → *...*
            formattedContent = formattedContent.replace(/^[\t ]*#{1,6}[\t ]+(.+)$/gm, '*$1*');

            // Blockquotes (> ...) and <blockquote>
            formattedContent = formattedContent
                .replace(/^[\t ]*>[\t ]+/gm, '> ')
                .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (_m, p1) => String(p1).replace(/^/gm, '> '));

            // Basic HTML → text
            formattedContent = formattedContent
                .replace(/<br\s*\/?>(\n)?/gi, '\n')
                .replace(/<\/(p|div)>\s*<\1>/gi, '\n\n')
                .replace(/<\/(h\d)>\s*/gi, '\n\n')
                .replace(/<\/?(p|div|span)>/gi, '')
                .replace(/<[^>]+>/g, '');

            // Restore bullet sentinel to WhatsApp bullet style
            formattedContent = formattedContent.replace(/^§BULLET§ /gm, '* ');

            if (!preserveStructure) {
                formattedContent = formattedContent
                    .replace(/\n{3,}/g, '\n\n')
                    .replace(/[ ]{2,}/g, ' ');
            }

            // Restore code placeholders
            formattedContent = formattedContent.replace(/__INLINECODE_(\d+)__/g, (_m, i) => '`' + (inlineCodes[Number(i)] ?? '') + '`');
            formattedContent = formattedContent.replace(/__CODEBLOCK_(\d+)__/g, (_m, i) => '```' + (codeBlocks[Number(i)] ?? '') + '```');

            console.log('✅ WhatsApp formatting completed', {
                originalLength,
                formattedLength: formattedContent.length,
                reduction: originalLength - formattedContent.length
            });
            return formattedContent;
        } catch (error) {
            console.log('⚠️ Error in WhatsApp formatting, sending original content', error);
            return content;
        }
    }

    private async sendMessage(
        clientId: string,
        number: string, 
        message: string, 
        contexts: ChatMessage[] | null, 
        initial: boolean, 
        campaign: string | null
    ): Promise<void> {
        console.log(`📤 sendMessage called for ${number} with message: "${message}"`);
        console.log(`📤 Initial: ${initial}, Campaign: ${campaign}`);
        
        try {
            const formattedNumber = `${number}@c.us`;
            
            if (initial) {
                const response = await this.whatsappService.sendMessage(clientId, formattedNumber, message);
                console.log('Message sent successfully:');
                return;
            } 

            // Get user contact information
            let userName: string = 'WhatsApp User';
            try {
                const client = this.whatsappService.getClient(clientId);
                if (client) {
                    const contact = await client.client.getContactById(formattedNumber);
                    if (contact && contact.pushname) {
                        userName = contact.pushname;
                    }
                }
            } catch (error) {
                console.log('Could not get contact info, using default name');
            }

            let aiagent: any;
            console.log(`🤖 Calling AI API with message: "${message}"`);
            console.log(`🤖 AI API Parameters:`, {
                message,
                phoneNumber: number,
                userName,
                clientId
            });
            aiagent = await this.callInferenceFw(message, number, userName, clientId);
            console.log(`🤖 AI Response received:`, aiagent);
            
            // Validate that we have a valid response text
            if (!aiagent || !aiagent.text) {
                console.error('❌ Invalid AI response:', aiagent);
                return;
            }
            
            try {
                // Check if client is ready and authenticated
                const client = this.whatsappService.getClient(clientId);
                if (!client) {
                    console.error('WhatsApp client not found:', clientId);
                    return;
                }
                
                // Check if client is connected
                const clientState = await client.client.getState();
                if (clientState !== 'CONNECTED') {
                    console.error('WhatsApp client not connected, state:', clientState);
                    return;
                }
                
                // Additional check for client state
                if (!client.client.pupPage || client.client.pupPage.isClosed()) {
                    console.error('WhatsApp client page not ready');
                    return;
                }
                    
                // Validate the phone number format
                if (!formattedNumber || !formattedNumber.includes('@')) {
                    console.error('Invalid phone number format:', formattedNumber);
                    return;
                }
                
                // Extract explicit Markdown images first: ![alt](url)
                const imageMdRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s]+)\)/g;
                const extractedMediaList: { url: string; caption?: string | undefined }[] = [];
                const withMediaTokens = (aiagent.text || '').replace(imageMdRegex, (_m: string, alt: string, url: string) => {
                    const idx = extractedMediaList.length;
                    const cap = String(alt || '').trim();
                    extractedMediaList.push({ url: String(url), caption: cap.length > 0 ? cap : undefined });
                    return `[[MEDIA_${idx}]]`;
                });

                // Normalize and convert LLM markdown to WhatsApp formatting before splitting
                const normalizedText = this.convertLLMToWhatsApp(withMediaTokens, true);
                // Split by double newlines as logical blocks
                const rawBlocks = normalizedText.split('\n\n').map(b => b.trim()).filter(Boolean);

                // Within each block, extract media URLs prefixed by '@' and schedule sends in-order
                // Only treat as media if URL ends with a known media extension (images/videos/audio), optional query/hash
                // Examples: @https://example.com/file.png, @https://cdn/x.mp4?token=abc
                const mediaExtPattern = '(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv|mp3|wav|ogg|m4a|aac)';
                const urlRegex = new RegExp('@\\s*(https?:\\/\\/[^\\s]+?\\.(?:' + mediaExtPattern + ')(?:[?#][^\\s]*)?)', 'gi');

                type OutgoingPart = { kind: 'text' | 'media'; value: string; caption?: string | undefined };
                const outgoingParts: OutgoingPart[] = [];

                for (const block of rawBlocks) {
                    // Build a combined scanner to extract, in order:
                    // 1) explicit markdown image tokens __MEDIA_n__
                    // 2) @explicit media URLs by extension
                    // 3) bare media URLs by extension
                    const mediaExtPattern = '(?:png|jpe?g|gif|webp|bmp|svg|mp4|mov|m4v|webm|avi|mkv|mp3|wav|ogg|m4a|aac)';
                    const combined = new RegExp(
                        `(__MEDIA_(\\d+)__|\\[\\[MEDIA_(\\d+)\\]\\])|@\\s*(https?:\\/\\/[^\\s]+\\.(?:${mediaExtPattern})(?:[?#][^\\s]*)?)|(https?:\\/\\/[^\\s]+\\.(?:${mediaExtPattern})(?:[?#][^\\s]*)?)`,
                        'gi'
                    );
                    let lastIndex = 0;
                    let m: RegExpExecArray | null;
                    while ((m = combined.exec(block)) !== null) {
                        const pre = block.slice(lastIndex, m.index).trim();
                        if (pre) outgoingParts.push({ kind: 'text', value: pre });

                        if (m[1]) {
                            // media token: either __MEDIA_n__ or [[MEDIA_n]]
                            const idx = Number(m[2] ?? m[3] ?? -1);
                            const meta = extractedMediaList[idx];
                            if (meta && meta.url) {
                                outgoingParts.push({ kind: 'media', value: meta.url, caption: meta.caption });
                            } else {
                                // Fallback: keep the token textually if something went wrong
                                outgoingParts.push({ kind: 'text', value: m[0] });
                            }
                        } else {
                            // Either @media url (group 3) or bare media url (group 4)
                            const url = (m[4] || m[5]) ?? '';
                            if (url) outgoingParts.push({ kind: 'media', value: url });
                        }

                        lastIndex = m.index + m[0].length;
                    }
                    const tail = block.slice(lastIndex).trim();
                    if (tail) outgoingParts.push({ kind: 'text', value: tail });
                }

                console.log(`📝 Prepared ${outgoingParts.length} outgoing part(s) for ${formattedNumber}`);

                for (let i = 0; i < outgoingParts.length; i++) {
                    const part = outgoingParts[i];
                    if (!part) continue;
                    try {
                        const chat = await client.client.getChatById(formattedNumber);
                        await chat.sendStateTyping();
                    } catch {}

                    if (part.kind === 'media') {
                        try {
                            const mediaUrl = String(part.value);
                            const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
                            try {
                                if (part.caption) {
                                    await client.client.sendMessage(formattedNumber, media, { caption: part.caption });
                                } else {
                                    await client.client.sendMessage(formattedNumber, media);
                                }
                                console.log(`🖼️ Sent media from ${mediaUrl}`);
                            } catch (sendErr: any) {
                                const errorMessage = (sendErr?.message || '').toString();
                                if (errorMessage.includes('serialize')) {
                                    console.log('✅ Media likely sent successfully (WhatsApp Web.js internal error)');
                                    // Do not send URL fallback to avoid duplicates
                                } else {
                                    console.log('⚠️ WhatsApp Web.js error sending media:', errorMessage);
                                    // Fallback: send URL as text only for real failures
                                    await client.client.sendMessage(formattedNumber, part.value);
                                }
                            }
                        } catch (mediaErr: any) {
                            console.log(`⚠️ Failed to fetch media ${String(part.value)}:`, mediaErr?.message || mediaErr);
                            // Fallback: send URL as text if fetching media fails
                            await client.client.sendMessage(formattedNumber, part.value);
                        }
                    } else {
                        // text
                        try {
                            await client.client.sendMessage(formattedNumber, part.value);
                            console.log(`✅ Sent text part`);
                        } catch (textErr: any) {
                            const errorMessage = textErr?.message || 'Unknown error';
                            if (errorMessage.includes('serialize')) {
                                console.log('✅ Text likely sent successfully (WhatsApp Web.js internal error)');
                            } else {
                                console.log('⚠️ WhatsApp Web.js error for text part:', errorMessage);
                            }
                        }
                    }

                    // Natural delay between parts
                    if (i < outgoingParts.length - 1) {
                        const delayMs = 1000 + Math.floor(Math.random() * 2000);
                        console.log(`⏳ Waiting ${delayMs}ms before next part`);
                        try {
                            const chat = await client.client.getChatById(formattedNumber);
                            await chat.sendStateTyping();
                        } catch {}
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    }
                }
                
                console.log('Message sent successfully:', aiagent.text);
            } catch (sendError: any) {
                // This is a known WhatsApp Web.js issue - messages often send successfully despite this error
                console.log('⚠️  WhatsApp Web.js error (message may have been sent):', sendError?.message || 'Unknown error');
                // Don't throw the error, just log it to prevent crashes
            }
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    private async callInferenceFw(message: string, phoneNumber: string, userName: string, clientId: string): Promise<any> {
        try {
            // Get client info to check if agent is assigned
            const clientInfo = this.whatsappService.getClient(clientId);
            if (!clientInfo) {
                console.error(`❌ Client ${clientId} not found`);
                return { text: "Please connect to an agent" };
            }

            // Check if client has an agent assigned
            if (!clientInfo.ai_agent_code) {
                console.log(`⚠️ No agent assigned to client ${clientId}, sending default message`);
                return { text: "Please connect to an agent" };
            }

            let url = this.env.FW_ENDPOINT || 'http://localhost:3000/api/agents/generalAssistanceAgent/generate/vnext';
            // Ensure URL has protocol
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            const jwtSecret = this.env.JWT_SECRET || 'your-jwt-secret-key';
            
            // Generate JWT token dynamically
            const payload = {
                iss: 'whatsapp-bot',
                sub: 'custom-user-id',
                aud: 'authenticated',
                iat: Math.floor(Date.now() / 1000),
                phone: phoneNumber || 'unknown',
                role: 'authenticated',
                agent_metadata: {
                    agent_code: clientInfo.ai_agent_code,
                    status: "active",
                },
                app_metadata: {
                    provider: 'wa',
                    providers: ['wa']
                },
                user_metadata: {
                    phone: phoneNumber || 'unknown',
                    phone_verified: true,
                    full_name: userName || 'WhatsApp User',
                    sub: 'custom-user-id',
                    campaign_id: '6a793f4c-609d-4507-ad4f-d6d25c1218c8',
                    participant_name: userName || 'WhatsApp User',
                    participant_phone: phoneNumber || 'unknown'
                }
            };

            const authToken = await this.signJWT(payload, jwtSecret);
            
            // Format the phone number for threadId and resourceId
            const formattedPhoneNumber = phoneNumber || 'unknown';
            
            const requestBody = {
                messages: [message],
                threadId: formattedPhoneNumber,
                resourceId: formattedPhoneNumber
            };

            console.log(`🤖 Request URL: ${url}`);

            const response = await axios.post(url, requestBody, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                }
            });

            console.log(`🤖 Response Status: ${response.status} ${response.status >= 200 && response.status < 300 ? '✅' : '❌'}`);

            const rsp = response.data;
            const jsonData = {
                text: rsp.text || 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
                session: null
            };
            
            // Ensure we always have a valid text response
            if (!jsonData.text || jsonData.text.trim() === '') {
                console.error('❌ AI response has empty or invalid text:', jsonData);
                jsonData.text = 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu';
            }
            
            return jsonData;
        } catch (error) {
            console.error('❌ Error during AI inference:', error);
            if (axios.isAxiosError(error)) {
                console.error('❌ Axios Error Details:');
                console.error('  - Status:', error.response?.status);
                console.error('  - Status Text:', error.response?.statusText);
                console.error('  - Response Data:', error.response?.data);
                console.error('  - Request URL:', error.config?.url);
                console.error('  - Request Headers:', error.config?.headers);
            }
            return {
                text: 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
                session: null
            };
        }
    }

    private async signJWT(payload: any, secret: string): Promise<string> {
        return jwt.sign(payload, secret, { algorithm: 'HS256' });
    }

    public cleanup(): void {
        // Clean up message queues and processing states
        Object.keys(this.messageQueue).forEach(key => delete this.messageQueue[key]);
        Object.keys(this.processingUsers).forEach(key => delete this.processingUsers[key]);
        console.log('🧹 MessageHandler cleanup completed');
    }
}
