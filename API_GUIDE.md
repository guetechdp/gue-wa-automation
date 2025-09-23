# WhatsApp Bot API - Complete Guide 📚

## 🚀 Quick Start

The WhatsApp Bot API provides a comprehensive REST API for managing multiple WhatsApp clients with session persistence and AI integration.

**Base URL**: `http://localhost:3003`  
**Documentation**: `http://localhost:3003/documentation/`

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Client Management](#client-management)
3. [QR Code Management](#qr-code-management)
4. [Message Operations](#message-operations)
5. [Health & Monitoring](#health--monitoring)
6. [Testing & Debugging](#testing--debugging)
7. [Error Handling](#error-handling)
8. [Response Formats](#response-formats)

## 🔐 Authentication

Currently, the API does not require authentication for basic operations. However, AI API integration uses JWT tokens internally.

## 🚀 Client Management

### Create a New WhatsApp Client

Creates a new WhatsApp client instance that can be used to send and receive messages.

```http
POST /api/whatsapp/clients
Content-Type: application/json

{
  "clientId": "my-whatsapp-client"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Client created successfully",
  "data": {
    "clientId": "my-whatsapp-client",
    "status": "initializing",
    "isReady": false,
    "hasQrCode": false,
    "lastActivity": "2025-09-23T01:54:52.268Z"
  }
}
```

### List All Clients

Retrieves information about all active WhatsApp clients.

```http
GET /api/whatsapp/clients
```

**Response:**
```json
{
  "success": true,
  "message": "Clients retrieved successfully",
  "data": [
    {
      "clientId": "javear-account",
      "status": "qr_required",
      "isReady": false,
      "hasQrCode": true,
      "lastActivity": "2025-09-23T01:54:49.506Z"
    },
    {
      "clientId": "official-docs-test",
      "status": "ready",
      "isReady": true,
      "phoneNumber": "6285128007906@c.us",
      "hasQrCode": false,
      "lastActivity": "2025-09-23T01:54:50.490Z"
    }
  ]
}
```

### Get Client Status

Retrieves detailed information about a specific client.

```http
GET /api/whatsapp/clients/{clientId}
```

**Response:**
```json
{
  "success": true,
  "message": "Client status retrieved successfully",
  "data": {
    "clientId": "official-docs-test",
    "status": "ready",
    "isReady": true,
    "phoneNumber": "6285128007906@c.us",
    "hasQrCode": false,
    "lastActivity": "2025-09-23T01:54:50.490Z",
    "qrCode": null
  }
}
```

### Disconnect Client

Disconnects a WhatsApp client and removes it from the system.

```http
DELETE /api/whatsapp/clients/{clientId}
```

**Response:**
```json
{
  "success": true,
  "message": "Client disconnected successfully"
}
```

### Remove Client

Completely removes a client and cleans up its session data.

```http
DELETE /api/whatsapp/clients/{clientId}/remove
```

**Response:**
```json
{
  "success": true,
  "message": "Client removed successfully"
}
```

### Recover Client

Attempts to recover a failed or stuck client.

```http
POST /api/whatsapp/clients/{clientId}/recover
Content-Type: application/json

{
  "forceReset": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Client recovery initiated"
}
```

### Reset Client to QR Scanning

Forces a client back to QR code scanning mode.

```http
POST /api/whatsapp/clients/{clientId}/reset-to-qr
```

**Response:**
```json
{
  "success": true,
  "message": "Client reset to QR scanning mode"
}
```

## 📱 QR Code Management

### Get QR Code Data

Retrieves the QR code data for client authentication.

```http
GET /api/whatsapp/clients/{clientId}/qr
```

**Response:**
```json
{
  "success": true,
  "message": "QR code retrieved successfully",
  "data": {
    "qrCode": "2@ABC123DEF456...",
    "clientId": "my-whatsapp-client"
  }
}
```

### Get QR Code Image

Retrieves the QR code as a base64-encoded PNG image.

```http
GET /api/whatsapp/clients/{clientId}/qr-image
```

**Response:**
```json
{
  "success": true,
  "message": "QR code image retrieved successfully",
  "data": {
    "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
    "clientId": "my-whatsapp-client"
  }
}
```

### Refresh QR Code

Generates a new QR code for the client.

```http
POST /api/whatsapp/clients/{clientId}/refresh-qr
```

**Response:**
```json
{
  "success": true,
  "message": "QR code refreshed successfully"
}
```

## 💬 Message Operations

### Send Message

Sends a message through a specific WhatsApp client.

```http
POST /api/whatsapp/clients/{clientId}/send
Content-Type: application/json

{
  "number": "6282121547121",
  "message": "Hello from WhatsApp Bot!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "messageId": "3EB0C767D26A8B4A5C9A",
    "to": "6282121547121@c.us",
    "message": "Hello from WhatsApp Bot!"
  }
}
```

## 🏥 Health & Monitoring

### System Health Check

Checks the overall health of the WhatsApp Bot API.

```http
GET /health
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp Bot API is healthy",
  "status": {
    "totalClients": 2,
    "readyClients": 1,
    "errorClients": 0,
    "isHealthy": true,
    "clients": [
      {
        "clientId": "javear-account",
        "status": "qr_required",
        "isReady": false,
        "hasQrCode": true,
        "lastActivity": "2025-09-23T01:54:49.506Z"
      },
      {
        "clientId": "official-docs-test",
        "status": "ready",
        "isReady": true,
        "phoneNumber": "6285128007906@c.us",
        "hasQrCode": false,
        "lastActivity": "2025-09-23T01:54:50.490Z"
      }
    ]
  },
  "timestamp": "2025-09-23T01:54:52.268Z"
}
```

### WhatsApp Service Health

Checks the health of the WhatsApp service specifically.

```http
GET /api/whatsapp/health
```

**Response:**
```json
{
  "success": true,
  "message": "WhatsApp service is healthy",
  "data": {
    "totalClients": 2,
    "readyClients": 1,
    "errorClients": 0,
    "isHealthy": true
  }
}
```

## 🧪 Testing & Debugging

### Test AI API

Tests the AI API integration with a sample message.

```http
POST /api/test-ai-api
Content-Type: application/json

{
  "message": "Hello, how are you?",
  "phoneNumber": "6282121547121",
  "clientId": "test-client"
}
```

**Response:**
```json
{
  "success": true,
  "message": "AI API test completed successfully",
  "data": {
    "response": "Hello! I'm doing well, thank you for asking. How can I help you today?",
    "status": "success"
  }
}
```

### MongoDB Status

Checks the MongoDB connection status.

```http
GET /api/mongodb/status
```

**Response:**
```json
{
  "success": true,
  "message": "MongoDB connection is healthy",
  "data": {
    "connected": true,
    "host": "localhost",
    "port": 27017,
    "database": "whatsapp-bot"
  }
}
```

### MongoDB Debug

Retrieves detailed MongoDB debug information.

```http
GET /api/mongodb/debug
```

**Response:**
```json
{
  "success": true,
  "message": "MongoDB debug information retrieved",
  "totalCollections": 6,
  "sessionCollectionsCount": 4,
  "allCollections": [
    {
      "name": "whatsapp-RemoteAuth-javear-account.chunks",
      "type": "collection"
    },
    {
      "name": "whatsapp-RemoteAuth-official-docs-test.files",
      "type": "collection"
    }
  ],
  "sessionCollections": [
    {
      "name": "whatsapp-RemoteAuth-javear-account.files",
      "type": "collection"
    }
  ],
  "timestamp": "2025-09-23T01:54:52.268Z"
}
```

## ⚠️ Error Handling

### Error Response Format

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "message": "Detailed error description",
  "timestamp": "2025-09-23T01:54:52.268Z"
}
```

### Common Error Codes

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| 400 | Bad Request | Invalid request body or parameters |
| 404 | Not Found | Client or resource not found |
| 500 | Internal Server Error | Server-side error or client failure |

### Example Error Responses

**Client Not Found:**
```json
{
  "success": false,
  "error": "Client not found",
  "message": "No client found with ID: non-existent-client"
}
```

**Client Not Ready:**
```json
{
  "success": false,
  "error": "Client not ready",
  "message": "Client is not ready to send messages. Current status: qr_required"
}
```

## 📊 Response Formats

### Success Response Format

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data varies by endpoint
  },
  "timestamp": "2025-09-23T01:54:52.268Z"
}
```

### Client Status Values

| Status | Description |
|--------|-------------|
| `initializing` | Client is being created and initialized |
| `qr_required` | Client needs QR code authentication |
| `ready` | Client is authenticated and ready to send messages |
| `authenticated` | Client is authenticated (legacy status) |
| `session_saved` | Client session has been saved to MongoDB |
| `error` | Client encountered an error |

## 🔄 Client Lifecycle

1. **Create Client** → Status: `initializing`
2. **Generate QR Code** → Status: `qr_required`
3. **Scan QR Code** → Status: `ready`
4. **Session Saved** → Status: `session_saved`
5. **Send Messages** → Client remains `ready`

## 🚨 Troubleshooting

### Client Stuck in "initializing"
- Check MongoDB connection
- Verify Chromium installation
- Review system resources

### Session Not Persisting
- Verify MongoDB connection
- Check MongoDB permissions
- Review session cleanup logs

### AI API Errors
- Verify `FW_ENDPOINT` configuration
- Check JWT secret configuration
- Review AI API response format

### QR Code Issues
- Check client status
- Verify Chromium installation
- Review client initialization logs

## 📝 Best Practices

1. **Always check client status** before sending messages
2. **Handle QR code expiration** by refreshing when needed
3. **Monitor client health** using the health endpoints
4. **Use proper error handling** for all API calls
5. **Clean up unused clients** to free resources

## 🔗 Related Documentation

- [README.md](README.md) - Project overview and setup
- [Swagger Documentation](http://localhost:3003/documentation/) - Interactive API documentation
- [Environment Configuration](.env.example) - Environment variables reference

---

**Need help?** Check the [Swagger Documentation](http://localhost:3003/documentation/) for interactive API exploration!
