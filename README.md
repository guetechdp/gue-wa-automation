# WhatsApp Bot with AI Integration (TypeScript)

A TypeScript-based WhatsApp bot that integrates with AI services for automated responses with message queuing and deduplication.

## Features

- **WhatsApp Web Integration**: Uses whatsapp-web.js for seamless WhatsApp connectivity
- **AI-Powered Responses**: Integrates with AI inference API for intelligent message handling
- **Message Queuing**: Prevents spam by batching messages from the same user within a time window
- **Session Management**: Maintains conversation context using LokiJS database
- **TypeScript Support**: Full TypeScript implementation with strict type checking
- **Docker Support**: Containerized deployment with multi-stage builds
- **Health Monitoring**: Built-in health check endpoints
- **Graceful Shutdown**: Proper cleanup on application termination

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Chromium browser (for WhatsApp Web.js)

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd entrlab-wa
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Install TypeScript dependencies**:
   ```bash
   npm install -D typescript ts-node @types/node @types/express @types/lokijs
   ```

4. **Create environment file**:
   ```bash
   cp .env.example .env
   ```

## Environment Variables

Create a `.env` file with the following variables:

```env
# Application
NODE_ENV=development
PORT=3000
M_WAITING_TIME=30000

# Chromium
CHROMIUM_PATH=/usr/bin/chromium

# Development Whitelist
WHITELISTED_NUMBERS=1234567890,9876543210

# AI Configuration
AI_AGENT=FW  # or ALI

# AliWF Configuration
ALIWF_SCOPE_API_KEY=your_api_key_here
ALIWF_APP_ID=your_app_id_here

# FW Configuration
FW_ENDPOINT=https://your-fw-endpoint.com/api
```

## Development

### Running in Development Mode

```bash
# Run with ts-node (no build required)
npm run dev

# Or build and run
npm run build
npm start
```

### Building for Production

```bash
# Build TypeScript to JavaScript
npm run build

# Run the built version
npm start
```

### Watch Mode (Development)

```bash
# Watch for changes and rebuild
npm run watch
```

## Usage

### Starting the Bot

1. **Run the application**:
   ```bash
   npm run dev
   ```

2. **Scan QR Code**: The bot will display a QR code in the terminal. Scan it with WhatsApp Web.

3. **Bot is Ready**: Once authenticated, the bot will start processing messages.

## API Endpoints

### Health Check
- `GET /health` - Check if the server is running

### QR Code Management
- `GET /qr` - Get the current QR code for WhatsApp authentication
- `GET /qr/status` - Check QR code availability and authentication status

### Bot Status
- `GET /bot/status` - Get bot status, phone number, and authentication state

### Message Sending
- `POST /greetings` - Send a message to a specific number (for initial greetings)

#### Example Usage

```bash
# Get QR code
curl http://localhost:3000/qr

# Check QR status
curl http://localhost:3000/qr/status

# Check bot status
curl http://localhost:3000/bot/status

# Send greeting message
curl -X POST http://localhost:3000/greetings \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "1234567890",
    "message": "Hello!",
    "campaign": "welcome"
  }'
```

## Message Processing Logic

### Message Queuing System

The bot implements a sophisticated message queuing system:

1. **First Message**: When a user sends a message, it's marked as "being processed" and a 30-second timer starts
2. **Subsequent Messages**: If the same user sends more messages during the 30-second window, they're added to a queue
3. **Batch Processing**: After 30 seconds, all queued messages are processed together as one conversation
4. **AI Response**: Only one AI call is made per user per 30-second window

### Benefits

- **Reduced API Calls**: Only one AI inference call per user per 30 seconds
- **Better User Experience**: Multiple messages are treated as one conversation
- **Memory Efficient**: Proper cleanup prevents memory leaks
- **Scalable**: Can handle multiple users simultaneously without conflicts

## TypeScript Features

### Type Safety

- **Strict Type Checking**: All variables and functions are properly typed
- **Interface Definitions**: Clear contracts for data structures
- **Error Handling**: Type-safe error handling throughout the application

### Key Interfaces

```typescript
// AI Agent Response
interface AIAgentResponse {
  text: string;
  session: string | null;
}

// Message Queue
interface MessageQueue {
  [key: string]: QueuedMessage[];
}

// Database Entry
interface NumberEntry {
  number: string;
  campaign?: string;
  session?: string;
}
```

## Project Structure

```
src/
├── index.ts          # Main application file
├── types.ts          # TypeScript type definitions
└── ...

dist/                 # Compiled JavaScript (after build)
├── index.js
└── types.js

package.json          # Dependencies and scripts
tsconfig.json         # TypeScript configuration
README.md            # This file
```

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run start` - Run the compiled JavaScript in production
- `npm run dev` - Run the TypeScript source directly in development (with cleanup)
- `npm run dev:clean` - Clean startup with session preservation (recommended for development)
- `npm run dev:preserve` - Start without any cleanup (preserves session completely)
- `npm run watch` - Watch for TypeScript changes and recompile automatically
- `npm run restart` - Stop, clean up, and restart the bot

### Development Startup Options

**For normal development (preserves session):**
```bash
npm run dev:clean
```

**For completely fresh start (removes session):**
```bash
npm run dev
```

**For preserving session completely (no cleanup):**
```bash
npm run dev:preserve
```

The `dev:clean` script preserves your WhatsApp session while still cleaning up processes and lock files.

## Error Handling

The bot includes comprehensive error handling:

- **Graceful Shutdown**: Proper cleanup on SIGINT/SIGTERM
- **Memory Leak Prevention**: Periodic cleanup of stale processing states
- **Connection Recovery**: Automatic reconnection on disconnection
- **Type Safety**: TypeScript prevents many runtime errors

## Production Deployment

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/
COPY .env ./

EXPOSE 3000
CMD ["npm", "start"]
```

### Railway/Heroku

The bot is configured for Railway deployment with persistent storage:

- Session data stored in `/data/.wwebjs_auth`
- Database stored in persistent volume
- Environment variables configured for production

## Troubleshooting

### Common Issues

1. **Chromium not found**: Set `CHROMIUM_PATH` environment variable
2. **QR Code not displaying**: Check terminal output and ensure proper display
3. **Memory leaks**: Check if cleanup functions are working properly
4. **Type errors**: Run `npm run build` to see compilation errors

### Debug Mode

Enable debug logging by setting:

```env
NODE_ENV=development
DEBUG=whatsapp-web.js:*
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License - see LICENSE file for details. 