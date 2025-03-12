const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
// Import the required OpenAI components
const { OpenAI } = require('openai');
const { HfInference } = require('@huggingface/inference');
const { jsonrepair } = require('jsonrepair');
const { Together } = require("together-ai");
const loki = require('lokijs');
const { Invoice } = require('xendit-node'); 
require('dotenv').config();

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

// Initialize the Invoice module with your secret API key
const invoice = new Invoice({
    secretKey: 'xnd_development_zv3GUpIrp4tyayARzkNwmp0gO3NzZ6Dc9z8jaRbXiS43PX651oygCLqzObFQ6kQ', // Replace with your secret API key
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
const BROWSER_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';

// Map class names or keys to their corresponding class constructors
const InferenceClasses = {
    OpenAI,    // Key points to the HfInference class
    HfInference,   // Key points to the HfInference2 class
    Together    // Key points to the HfInference3 class
};

const config = {
    model: process.env.MODEL_NAME,
    max_tokens: 512,
    temperature: 0.7,
    top_p: 0.7,
    top_k: 50,
    repetition_penalty: 1,
    stop: ["<|eot_id|>","<|eom_id|>"],
    stream: false
}

// Huging Face Inference Default Config
/*
model: "meta-llama/Meta-Llama-3-8B-Instruct",
messages: messages,
max_tokens: 500,
temperature: 0.7,
do_sample: true,
top_p: 0.9,  // Nucleus sampling
top_k: 40,   // Limits the number of tokens considered for each step
*/

// OPEN AI Inference Default Config
/*
model: 'gpt-4o',
messages: messages,
max_tokens: 400
*/

allowedNumbers = []; // Replace with actual numbers
// Split the string by '.' to get the path
try{
    if(!productionmode){
        unumbers = process.env.WHITELISTED_NUMBERS;
        allowedNumbers = unumbers.split(',');
    }
}catch(e){}

// Function to dynamically create an instance from a class name
function getDynamicInferenceInstance() {
    const className = process.env['USEDINFERENCE'];
    const InferenceClass = InferenceClasses[className]; // Get class constructor from the map
    const apiKey = process.env[className + 'KEY'];
    if (!InferenceClass) {
        throw new Error(`${className} is not a valid inference class.`);
    }

    if (!apiKey) {
        throw new Error("API key is required to create an inference instance.");
    }

    if(className == 'HfInference') {
        return new InferenceClass(apiKey); // Dynamically instantiate the class
    } else {
        return new InferenceClass({ apiKey: apiKey }); // Dynamically instantiate the class
    }
    
}

const inference = getDynamicInferenceInstance();
const functionNamePath = process.env['FunctionNamePath'];
//Functions
/*
TogetherAI: chat.completions.create
HugingFaceInference: chatCompletion
OpenAI: chat.completions.create
*/

let myWhatsAppNumber = null;

const formatbrief_initial_prompt = `
Buatlah pesan pembuka yang menarik disertai teaser produk ini dengan tujuan supaya calon pelanggan tertarik membeli produk ini dalam bahasa Indonesia,

Formatlah greeting kedalam JSON object sebagai berikut
{ "text" : "greeting", "related_marketing_material" : ["$url"] }. 
Jangan menambahkan pengantar seperti 'Here is the response:' ataupun pengantar lainya.`

const formatbrief_reply_prompt = `
Formatlah setiap balasan untuk calon pelanggan kedalam JSON object sebagai berikut
{ "text" : "llamamodelresponse", "customer_mood" : "interest/not_interest/angry/not_relate", "related_marketing_material" : ["$url"], "form_status" : "notyet/filled", "filled_form":{"name":"customer_name", "schedule": "DD/MM/YYY", "request": ""} }. 
Jangan menambahkan pengantar seperti 'Here is the response:' ataupun pengantar lainya.`

const persona_reply_prompt = `
Calon pelanggan mengatakan: '#message', buatlah balasan chat dari calon pelanggan tersebut pastikan balasanya menarik, interaktif dan cocok untuk milenial atau gen z.`;

const rules_greeting_prompt = `
Instruksi percakapan:
1. Gunakanlah emoji jika memungkinkan
2. Gunakan kata - kata yang kasual
3. Gunakan sapaan yang gaul sepert ( mums, bund, sis, bro, dll) daripada (kamu)` 

//2. Jika customer sudah mengisi data, mohon instruksikan untuk menunggu payment link yang akan dikirimkan beberapa saat lagi

const rules_reply_prompt = `
Instruksi yang kamu harus perhatikan dalam memberi balasan ke calon pelanggan:
1. Jika customer tidak tertarik, mohon untuk mengakhiri percakapan dan berterimakasih
2. Jika customer sudah mengisi data, mohon instruksikan untuk mengakses link berikut https://shopee.co.id/product/323888738/3870923786
3. Mohon untuk membatasi diri jika pertanyaan diluar konteks produk ataupun instruksi yang diluar pencarian informasi produk tersebut.
4. Gunakanlah emoji jika memungkinkan
5. Gunakan kata - kata yang kasual
6. Gunakan sapaan yang gaul sepert ( mums, bund, sis, bro, dll) daripada (kamu)` 

const order_prompt = `jika calon pelanggan tertarik atau ingin membeli, informasikan untuk memberikan data mandatory berupa Nama : ***, Varian: ***, Jumlah Pesanan: ***
`

const material_prompt = `
related_marketing_material :
materi untuk greeting = https://static.d2d.co.id/image/hc_banners/9b0d2c61-7014-4d2f-b11b-8333d998ddc1.png`

const nmessages = [
    { role: 'system', content: `Kamu adalah digital marketing yang akan menawarkan produk untuk milenial melalui percakapan, kamu juga mempunya tugas untuk membalas semua chat calon pelanggan
        DETAIL PRODUK
        - NAMA PRODUK: Madu Nutridat Penambah Nafsu Makan Anak 
        - RASA: Anggur, Strawbery, Original
        - HARGA: Rp 100.000 per botol
        - PROMO MENARIK: Tumbler Special, Beli 3 gratis 1
        - DESKRIPSI:
        Bingung si kecil susah makan?
        Sedih karena anak terus sakit-sakitan?
        Ingin memberikan nutrisi terbaik namun bingung gimana caranya?
        Ngga perlu khawatir kami punya SOLUSInya,  MADU NUTRIDAT (Madu Ikan Sidat)
        Madu ikan sidat dengan Formula Terlengkap yang pernah ada,Komposisi nya super komplit dengan kandungan 10 jenis herbal terbaik yang sudah banyak diuji berkhasiat untuk meningkatkan kecerdasan dan Nafsu Makan Buah hati anda
        Manfaat Nutridat untuk Anak Usia 1-12 tahun :
        Menambah nafsu makan anak, Meningkatkan kecerdasan, Meningkatkan imunitas (tidak gampang sakit), Menambah berat badan anak, Meningkatkan daya ingat, Suplemen anak penderita flek / TBC, Mempercepat penyembuhan semua penyakit pada anak terutama demam, flu dan batuk
        - KANDUNGAN: Madu Hutan 100% Murni, Ekstrak Ikan Sidat, Curcuma, Sari Kurma, Rosella, Habbatusauda, Pegagan, Propolis, Minyak Zaytun, Air Zam Zam`}
]

// Store the timestamp of the last reply for each chat
let lastReplyTime = {};

async function callInference(messages) {
    try {
        let newConfig = config;
        newConfig['messages'] = messages;
        // Split the string by '.' to get the path
        let func = inference
        if(functionNamePath){
            const fnPathArray = functionNamePath.split('.');
            for (const part of fnPathArray) {
                func = func[part]; // Traverse the object structure
            }
        }
        out = await func[process.env.FunctionInference](newConfig);
        let jsonData = null;
        console.log("out",out)
        console.log("out.choices[0]", out.choices[0])
        try{
            // Use regex to extract the JSON part from the string
            let ostranswer = out.choices[0].message.content;
            // Attempt to extract JSON part using regex
            const jsonMatch = ostranswer.match(/{.*}/s);
            if (jsonMatch) {
                // If JSON is found, proceed with parsing
                const stranswer = jsonMatch[0];
                ostranswer = jsonrepair(stranswer);
                jsonData = JSON.parse(ostranswer);
                if(!jsonData.text){
                    stranswer = stranswer.replaceAll('"', '');
                    jsonData = {
                        text : stranswer
                    }
                }
            } else {
                jsonData = {
                    text : ostranswer
                }
                try{
                    jsonDataRepair = jsonrepair(jsonData.text);
                    jsonData = JSON.parse(jsonDataRepair);
                }catch(err){}
            }
        }catch(err){
            console.log(err)
            jsonData = {
                text : 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu'
            }
        }
        console.log("jsonData", jsonData)
        return jsonData;
    } catch (error) {
      console.error('Error during inference:', error);
      return {
        text : 'Mohon maaf, saat ini saya belum bisa menjawab pertanyaanmu'
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
                    const messagescontext =  await getPreviousMessages(messageswait, latestMessage.timestamp)
                    if(usermessages){
                        rmessage =  usermessages;
                    }
                    if(messagescontext){
                        rcontext = messagescontext;
                    }
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
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,  // Optional: Run in headless mode for production
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath: BROWSER_PATH  // Make sure the correct path is used
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
        //const numberEntry = numbersCollection.findOne({ number });
        const numberEntry = true
        console.log("numberEntry", numberEntry)
        console.log("initial", initial)
        const formattedNumber = `${number}@c.us`;
        let messages = [...nmessages];
        messages[0].content = messages[0].content + material_prompt;
        if(!initial){
            if(numberEntry){
                let prompt = persona_reply_prompt.replace("#message", message); 
                messages[0].content = messages[0].content + order_prompt;
                messages[0].content = messages[0].content + rules_reply_prompt;
                if(contexts){
                    messages = messages.concat(contexts); 
                }
                messages.push({ role: 'user', content: prompt })
                messages.push({ role: 'user', content: formatbrief_reply_prompt })
                console.log("messages", messages)
                const aiagent = await callInference(messages)
                const response = await client.sendMessage(formattedNumber, aiagent.text);
                console.log('Message sent successfully:');
            }
        } else {
            if(!numberEntry){
                // Add the number to LokiJS collection
                numbersCollection.insert({ number, campaign });

                console.log("numbersCollection", numbersCollection)

                messages[0].content = messages[0].content + rules_greeting_prompt;
                messages.push({ role: 'user', content: formatbrief_initial_prompt });
                console.log("messages", messages)
                const aiagent = await callInference(messages)
                const response = await client.sendMessage(formattedNumber, aiagent.text);
                console.log('Message sent successfully:');
            }
        }
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

// Example usage
client.on('ready', () => {
    // Send a message when the client is ready
    const number = '6282299819518'; // Replace with the target number
    const message = 'Hello!';
    //sendMessage(number, message, true);
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

// Handle Disconnections and Reconnections
client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
    client.initialize();
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

/*
const createPaymentLink = async () => {
    try {
      const paymentLink = await invoice.createInvoice({data:{
          externalID: 'order-12345', // Replace with your order ID
          description: 'Payment for Order #12345',
          amount: 150000, // Amount in IDR
          invoiceDuration : 172800,
          description : "Test Invoice",
          currency : "IDR",
          reminderTime : 1
      }});
  
      console.log('Payment link created:', paymentLink.invoice_url);
    } catch (error) {
      console.error('Error creating payment link:', error);
    }
};
  
  createPaymentLink();
*/
