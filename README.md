# WhatsApp Bot API 🚀

A comprehensive WhatsApp bot API with multi-client support, session persistence, and AI integration built with Node.js, TypeScript, and MongoDB.

## ✨ Features

- **🔄 Multi-Client Support**: Manage multiple WhatsApp clients simultaneously
- **💾 Session Persistence**: MongoDB-based session storage with automatic restoration
- **🤖 AI Integration**: Built-in AI API integration with JWT authentication
- **📱 QR Code Management**: Automatic QR code generation and management
- **🏥 Health Monitoring**: Comprehensive health checks and status monitoring
- **📚 Auto-Generated API Docs**: Swagger/OpenAPI documentation
- **🔧 Robust Error Handling**: Automatic retry mechanisms and error recovery
- **🐳 Docker Support**: Containerized deployment ready

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- MongoDB instance
- Chromium browser (for WhatsApp Web)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd entrlab-wa
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Build and start**
   ```bash
   npm run build
   npm start
   ```

## 🔧 Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/whatsapp-bot

# AI API Configuration
FW_ENDPOINT=https://your-ai-api.com/api/agents/yourAgent/generate
JWT_SECRET=your-jwt-secret-key
AI_AGENT=your-agent-name

# WhatsApp Configuration
CHROMIUM_PATH=/usr/bin/chromium-browser
M_WAITING_TIME=30000

# Server Configuration
PORT=3003
NODE_ENV=production
```

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/whatsapp-bot` |
| `FW_ENDPOINT` | AI API endpoint URL | `https://api.example.com/generate` |
| `JWT_SECRET` | JWT signing secret | `your-secret-key` |
| `AI_AGENT` | AI agent identifier | `your-agent-name` |

## 📚 API Documentation

Once the server is running, access the interactive API documentation at:

**🔗 [http://localhost:3003/documentation](http://localhost:3003/documentation)**

### API Endpoints Overview

#### 🚀 Client Management
- `POST /api/whatsapp/clients` - Create new WhatsApp client
- `GET /api/whatsapp/clients` - List all clients
- `GET /api/whatsapp/clients/{clientId}` - Get client status
- `DELETE /api/whatsapp/clients/{clientId}` - Disconnect client
- `POST /api/whatsapp/clients/{clientId}/recover` - Recover failed client

#### 📱 QR Code Management
- `GET /api/whatsapp/clients/{clientId}/qr` - Get QR code data
- `GET /api/whatsapp/clients/{clientId}/qr-image` - Get QR code as PNG
- `POST /api/whatsapp/clients/{clientId}/refresh-qr` - Refresh QR code

#### 💬 Message Operations
- `POST /api/whatsapp/clients/{clientId}/send` - Send message

#### 🏥 Health & Status
- `GET /health` - System health check
- `GET /api/whatsapp/health` - WhatsApp service health

#### 🧪 Testing & Debugging
- `POST /api/test-ai-api` - Test AI API integration
- `GET /api/mongodb/status` - MongoDB connection status
- `GET /api/mongodb/debug` - MongoDB debug information

## 🔄 Usage Examples

### 1. Create a New WhatsApp Client

```bash
curl -X POST http://localhost:3003/api/whatsapp/clients \
  -H "Content-Type: application/json" \
  -d '{"clientId": "my-whatsapp-client"}'
```

### 2. Get Client Status

```bash
curl http://localhost:3003/api/whatsapp/clients/my-whatsapp-client
```

### 3. Get QR Code for Authentication

```bash
curl http://localhost:3003/api/whatsapp/clients/my-whatsapp-client/qr-image
```

### 4. Send a Message

```bash
curl -X POST http://localhost:3003/api/whatsapp/clients/my-whatsapp-client/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "6282121547121",
    "message": "Hello from WhatsApp Bot!"
  }'
```

### 5. Check System Health

```bash
curl http://localhost:3003/health
```

## 🏗️ Architecture

### Project Structure

```
src/
├── controllers/          # API controllers
│   ├── whatsapp.controller.ts
│   └── api.controller.ts
├── services/            # Business logic services
│   └── whatsapp.service.ts
├── routes/              # Express routes
│   ├── whatsapp.routes.ts
│   └── api.routes.ts
├── core/                # Core functionality
│   └── message-handler.ts
├── config/              # Configuration files
│   └── swagger.ts
├── types.ts             # TypeScript type definitions
├── client-manager.ts    # WhatsApp client management
├── app.ts               # Express application setup
└── index.ts             # Application entry point
```

### Key Components

- **ClientManager**: Manages WhatsApp client lifecycle and session persistence
- **WhatsAppService**: Business logic for client operations
- **MessageHandler**: Handles incoming messages and AI integration
- **Controllers**: Handle HTTP requests and responses
- **Routes**: Define API endpoints and middleware

## 🔐 Session Management

The bot uses MongoDB for session persistence with the following features:

- **Automatic Session Restoration**: Sessions are automatically restored on server restart
- **Multi-Client Support**: Each client has its own isolated session
- **Session Cleanup**: Automatic cleanup of corrupted or expired sessions
- **Health Monitoring**: Continuous monitoring of session health

### Session Storage

Sessions are stored in MongoDB using GridFS with the following collections:
- `whatsapp-RemoteAuth-{clientId}.files`
- `whatsapp-RemoteAuth-{clientId}.chunks`

## 🤖 AI Integration

The bot integrates with external AI APIs for intelligent message responses:

- **JWT Authentication**: Secure API communication
- **Message Formatting**: Automatic conversion of AI responses to WhatsApp format
- **Error Handling**: Robust error handling and fallback responses
- **Rate Limiting**: Built-in rate limiting and message queuing

## 🐳 Docker Deployment

### Build Docker Image

```bash
docker build -t whatsapp-bot .
```

### Run with Docker

```bash
docker run -d \
  --name whatsapp-bot \
  -p 3003:3003 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/whatsapp-bot \
  -e FW_ENDPOINT=https://your-ai-api.com/generate \
  -e JWT_SECRET=your-secret \
  whatsapp-bot
```

### Docker Compose

```yaml
version: '3.8'
services:
  whatsapp-bot:
    build: .
    ports:
      - "3003:3003"
    environment:
      - MONGODB_URI=mongodb://mongo:27017/whatsapp-bot
      - FW_ENDPOINT=https://your-ai-api.com/generate
      - JWT_SECRET=your-secret
    depends_on:
      - mongo

  mongo:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

volumes:
  mongo_data:
```

## 🔧 Development

### Scripts

```bash
npm run build          # Build TypeScript to JavaScript
npm start             # Start production server
npm run dev           # Start development server with hot reload
npm test              # Run tests
npm run lint          # Run ESLint
```

### Adding New Features

1. **Controllers**: Add new endpoints in `src/controllers/`
2. **Services**: Add business logic in `src/services/`
3. **Routes**: Define routes in `src/routes/`
4. **Types**: Add TypeScript types in `src/types.ts`
5. **Documentation**: Update Swagger schemas in `src/config/swagger.ts`

## 🚨 Troubleshooting

### Common Issues

1. **Client Stuck in "initializing"**
   - Check MongoDB connection
   - Verify Chromium installation
   - Check system resources

2. **Session Not Persisting**
   - Verify MongoDB connection
   - Check MongoDB permissions
   - Review session cleanup logs

3. **AI API Errors**
   - Verify `FW_ENDPOINT` configuration
   - Check JWT secret configuration
   - Review AI API response format

4. **QR Code Not Generating**
   - Check client status
   - Verify Chromium installation
   - Review client initialization logs

### Debug Commands

```bash
# Check system health
curl http://localhost:3003/health

# Check MongoDB status
curl http://localhost:3003/api/mongodb/status

# Debug MongoDB collections
curl http://localhost:3003/api/mongodb/debug

# Test AI API
curl -X POST http://localhost:3003/api/test-ai-api \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

## 📊 Monitoring

### Health Checks

The API provides comprehensive health monitoring:

- **System Health**: Overall system status
- **Client Status**: Individual client health
- **MongoDB Status**: Database connection status
- **Memory Usage**: System resource monitoring

### Logs

The application provides detailed logging for:
- Client lifecycle events
- Message processing
- Error handling
- Session management
- AI API interactions

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Update documentation
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:

- 📧 Email: support@example.com
- 📚 Documentation: [http://localhost:3003/documentation](http://localhost:3003/documentation)
- 🐛 Issues: [GitHub Issues](https://github.com/your-repo/issues)

---

**Made with ❤️ for WhatsApp automation**