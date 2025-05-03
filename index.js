const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const loki = require('lokijs');
const axios = require('axios');
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ensure Railway Persistent Storage is used
const SESSION_PATH = "/data/.wwebjs_auth"; 
const lockFile = path.join(SESSION_PATH, 'session', 'SingletonLock');

try {
    // Check if Chromium is already running
    const isRunning = execSync("pgrep -x chromium || pgrep -x chromium-browser || echo 0")
        .toString().trim() !== "0";

    if (!isRunning && fs.existsSync(lockFile)) {
        console.log("Removing existing SingletonLock file...");
        fs.unlinkSync(lockFile);
    }
} catch (error) {
    console.error("Error checking Chromium process:", error);
}

productionmode = false

if(process.env.NODE_ENV == 'production'){
    productionmode = true
}

const app = express();
// Express Middleware
app.use(express.json()); // To parse incoming JSON requests

// Initialize LokiJS and Create a Database
const db = new loki('automark.db', {
    autoload: true,
    autosave: true,
    autosaveInterval: 4000, // Save every 4 seconds
    persistenceMethod: 'localStorage' // You can also use 'fs' for file storage
});

db.loadDatabase({}, () => {
    numbersCollection = db.getCollection('numbers');
    // If collection doesn't exist, create it
    if (!numbersCollection) {
        numbersCollection = db.addCollection('numbers');
    }
});

messagewaitingtime = Number(process.env.M_WAITING_TIME)

// Ensure Puppeteer Path is Correct
const BROWSER_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

const config = {
    input: {},
    parameters: {},
    debug: {}
}

const configfw = {
    question: "",
    overrideConfig: {}
}

allowedNumbers = []; // Replace with actual numbers
// Split the string by '.' to get the path
try{
    if(!productionmode){
        unumbers = process.env.WHITELISTED_NUMBERS;
        allowedNumbers = unumbers.split(',');
    }
}catch(e){}

let myWhatsAppNumber = null;
const ALIWF_SCOPE_API_KEY = process.env.ALIWF_SCOPE_API_KEY; // Ensure this is set in your environment
const ALIWF_APP_ID = process.env.ALIWF_APP_ID; // Replace with your actual App ID
async function callInferenceAli(messages, session) {
    try {
        const url = `https://dashscope-intl.aliyuncs.com/api/v1/apps/${ALIWF_APP_ID}/completion`;
        
        let newConfig = config;
        newConfig['input']['prompt'] = messages;
        if(session){
            newConfig['input']['session_id'] = session;
        }
        const response = await axios.post(url, newConfig, {
            headers: {
                'Authorization': `Bearer ${ALIWF_SCOPE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const rsp = response.data;
        let jsonData = null;
        jsonData = {
            text : rsp.output.text,
            session: rsp.output.session_id
        }
        return jsonData;
    } catch (error) {
      console.error('Error during inference:', error);
      return {
        text : 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
        session: null
      }
    }
}

async function callInferenceFw(messages, session) {
    try {
        const url = process.env.FW_ENDPOINT;
        
        let newConfig = configfw;
        newConfig['question'] = messages;
        if(session){
            newConfig['overrideConfig']['sessionId'] = session;
        }
        const response = await axios.post(url, newConfig, {
            headers: {
                //'Authorization': `Bearer ${ALIWF_SCOPE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const rsp = response.data;
        let jsonData = null;
        jsonData = {
            text : rsp.text,
            session: rsp.sessionId
        }
        return jsonData;
    } catch (error) {
      console.error('Error during inference:', error);
      return {
        text : 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu',
        session: null
      }
    }
}


// Function to fetch messages after a specific timestamp
async function fetchMessagesAfterTimestamp(messages, timestamp) {
    const newMessages = messages.filter(message => message.timestamp > timestamp); // Filter messages after the given timestamp
    if (newMessages.length > 0) {
        mergedMessagesContent = newMessages.map(msg => msg.body).join('\n');
        console.log("mergedMessagesContent", mergedMessagesContent);
        return mergedMessagesContent
    } else {
        console.log('No new messages after my latest message.');
        return null
    }
}

// Function to fetch the last 10 messages after the latest reply and reply after a delay
async function replyToNewMessages(sender, message, delay = 30000) {
    const chatId = message.from;
    let rmessage = message.body;
    let rcontext = null
    // Get the current chat
    const chat = await message.getChat();
    // Wait for the specified delay before replying
    await setTimeout(async () => {
        const c_limit = 10
        const messageswait = await chat.fetchMessages({ limit: c_limit });
        if (messageswait.length > 0) {
            if(message.id._serialized == messageswait[messageswait.length-1].id._serialized){
                const myMessages = messageswait.filter(message => message.from === myWhatsAppNumber);
                if (myMessages.length > 0) {
                    const latestMessage = myMessages[myMessages.length-1]; // Get the latest message sent by you
                    const usermessages = await fetchMessagesAfterTimestamp(messageswait, latestMessage.timestamp)
                    //const messagescontext =  await getPreviousMessages(messageswait, latestMessage.timestamp)
                    if(usermessages){
                        rmessage =  usermessages;
                    }
                    /*
                    if(messagescontext){
                        rcontext = messagescontext;
                    }
                    */
                } else {
                    console.log('No messages found from me.');
                }
                await sendMessage(sender, rmessage, rcontext, false, null);
            }
        } 
    }, delay);
}

// Function to fetch messages after a specific timestamp
async function fetchMessagesAfterTimestamp(messages, timestamp) {
    const newMessages = messages.filter(message => message.timestamp > timestamp); // Filter messages after the given timestamp
    if (newMessages.length > 0) {
        mergedMessagesContent = newMessages.map(msg => msg.body).join('\n');
        return mergedMessagesContent
    } else {
        console.log('No new messages after my latest message.');
        return null
    }
}

// Function to get the 5 messages before the last reply and structure them
async function getPreviousMessages(messages, timestamp) {
    let conversation = null
    const previousMessages = messages.filter(msg => msg.timestamp <= timestamp);
    // Get the last 5 messages before the reply
    const lastFiveBeforeReply = previousMessages.slice(-4);
    // Map the lastFiveBeforeReply to the desired structure
    if (lastFiveBeforeReply.length > 0) {
        conversation = lastFiveBeforeReply.map(msg => ({
            role: msg.fromMe ? 'assistant' : 'user',  // 'assistant' if sent by bot, 'user' if sent by the other party
            content: msg.body
        }));
    }
    return conversation;
}

// Updated Puppeteer Configuration
/*
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH  // Force storage in /app
    }),
    puppeteer: {
        headless: true,  // Optional: Run in headless mode for production
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: BROWSER_PATH  // Make sure the correct path is used
    }
});
*/

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: SESSION_PATH  // Store session in Railway's persistent storage
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',   // Prevent crashes due to memory limits
            '--disable-gpu',             // Avoid GPU-related issues
            '--single-process',          // Prevent multiple processes
            '--no-zygote'                // Helps with containerized environments
        ],
        executablePath: BROWSER_PATH
    }
});
// Generate and display QR code
client.on('qr', (qr) => {
    // Generate and print the QR code in the terminal
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Client is ready!');

    // Get the current user's information
    myWhatsAppNumber = client.info.wid._serialized; // Format the number for use

    console.log("myWhatsAppNumber", myWhatsAppNumber)
    // You can call your other functions here
});


// Function to send a message
const sendMessage = async (number, message, contexts, initial, campaign) => {
    try {
        // Find the entry by the number field
        const numberEntry = numbersCollection.findOne({ number:number });


        let session = null
        //const numberEntry = true
        console.log("numberEntry", numberEntry)
        console.log("initial", initial)
        const formattedNumber = `${number}@c.us`;
        
        if(initial){
            const response = await client.sendMessage(formattedNumber, aiagent.text);
            console.log('Message sent successfully:');
        } 

        if(numberEntry){
            session = numberEntry.session
        } 

        let aiagent;
        if (process.env.AI_AGENT === "ALI") {
            aiagent = await callInferenceAli(message, session);
        } else if (process.env.AI_AGENT === "FW") {
            aiagent = await callInferenceFw(message, session);
        } else {
            aiagent = await callInferenceFw(message, session); // default
        }
        const response = await client.sendMessage(formattedNumber, aiagent.text);
        const new_session = aiagent.session;
        if(!session) {
            numbersCollection.insert({
                number: number,
                campaign: campaign,
                session: new_session
            });
        }
        console.log('Message sent successfully:');
    } catch (error) {
        console.error('Error sending message:', error);
    }
};


// Log when authenticated successfully
client.on('authenticated', () => {
    console.log('Successfully authenticated!');
});

client.on('auth_failure', () => {
    console.error('Authentication failed, retrying...');
});

// Handle connection issues and auto-reconnect
client.on('disconnected', (reason) => {
    console.log('Client disconnected, attempting to reconnect...', reason);
    client.initialize();  // Attempt to reinitialize the client
});

// Log when reconnecting
client.on('reconnecting', () => {
    console.log('Reconnecting to WhatsApp...');
});

// Log any connection state changes
client.on('change_state', (state) => {
    console.log('Connection state changed:', state);
});

// Event listener for incoming messages
client.on('message', async message => {
    console.log("message triggered")
    // Check if the sender's number is in the allowed numbers list
    const senderNumber = message.from.split('@')[0]; // Get the number without the domain
    if(productionmode){
        await replyToNewMessages(senderNumber, message, messagewaitingtime);  // 10-second delay
    } else {
        if (allowedNumbers.includes(senderNumber)) {
            await replyToNewMessages(senderNumber, message, messagewaitingtime);  // 15-second delay
            // Reply to new messages with a delay
        } else {
            console.log(`Message from ${senderNumber} ignored.`);
        }
    }
});

// Periodic check for client status and reinitialization if needed
setInterval(() => {
    if (!client.info) {
        console.log('Client info not available, attempting to reinitialize...');
        client.initialize();
    }
}, 60000);  // Check every minute

client.initialize();

// API Route to Call sendMessage
app.post('/greetings', async (req, res) => {
    try {
        const { sender, message, campaign} = req.body;
        if (!sender || !message || !campaign) {
            return res.status(400).send({ error: 'Sender and message are required.' });
        }
        // Call the sendMessage function with the received parameters
        await sendMessage(sender, message, null, true, campaign);
        res.send({ success: true, message: 'Message sent successfully' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ error: 'Failed to send message' });
    }
});

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

