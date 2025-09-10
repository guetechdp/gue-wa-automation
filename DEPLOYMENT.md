# Deployment Guide - TypeScript WhatsApp Bot

## 🚀 Docker Deployment

### Prerequisites
- Docker and Docker Compose installed
- Environment variables configured

### Quick Start

1. **Build and run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

2. **View logs:**
   ```bash
   docker-compose logs -f whatsapp-bot
   ```

3. **Stop the service:**
   ```bash
   docker-compose down
   ```

### Manual Docker Build

1. **Build the image:**
   ```bash
   docker build -t whatsapp-bot .
   ```

2. **Run the container:**
   ```bash
   docker run -d \
     --name whatsapp-bot \
     -p 3000:3000 \
     -e NODE_ENV=production \
     -e CHROMIUM_PATH=/usr/bin/chromium-browser \
     -e AI_AGENT=FW \
     -v whatsapp_data:/data \
     whatsapp-bot
   ```

## 🔧 Environment Variables

Create a `.env` file or set environment variables:

```env
# Application
NODE_ENV=production
PORT=3000
M_WAITING_TIME=30000

# Chromium
CHROMIUM_PATH=/usr/bin/chromium-browser

# AI Configuration
AI_AGENT=FW

# FW Configuration (New AI Inference API)
FW_ENDPOINT=http://localhost:3000/api/agents/herbakofAssistanceAgent/generate
JWT_SECRET=your-jwt-secret-key-here

# Development Whitelist (optional)
WHITELISTED_NUMBERS=1234567890,9876543210
```

## 📊 Health Monitoring

The bot includes a health check endpoint:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "memory": {
    "rss": 123456,
    "heapTotal": 98765,
    "heapUsed": 54321,
    "external": 1234
  },
  "environment": "production"
}
```

## 🔒 Security Features

- **Non-root user**: Runs as `nextjs` user (UID 1001)
- **Signal handling**: Uses `dumb-init` for proper signal handling
- **Resource limits**: Memory and CPU limits configured
- **Health checks**: Automatic health monitoring
- **Persistent storage**: WhatsApp session data persisted

## 📈 Resource Requirements

- **Memory**: 512MB minimum, 1GB recommended
- **CPU**: 0.25 cores minimum, 0.5 cores recommended
- **Storage**: 100MB for application + session data
- **Network**: Port 3000 for HTTP API

## 🐳 Docker Best Practices

### Multi-stage Build
- **Builder stage**: Compiles TypeScript to JavaScript
- **Production stage**: Minimal runtime with only production dependencies

### Security
- Alpine Linux base for smaller attack surface
- Non-root user execution
- Proper signal handling with dumb-init

### Performance
- Layer caching optimized
- Production-only dependencies
- Resource limits configured

## 🔍 Troubleshooting

### Common Issues

1. **Port already in use:**
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

2. **Chromium not found:**
   - Ensure `CHROMIUM_PATH` is set correctly
   - Check if Chromium is installed in container

3. **Permission denied:**
   ```bash
   sudo chown -R 1001:1001 /data
   ```

4. **Memory issues:**
   - Increase memory limit in docker-compose.yml
   - Monitor with `docker stats`

### Logs and Debugging

```bash
# View container logs
docker-compose logs -f whatsapp-bot

# Access container shell
docker exec -it whatsapp-bot sh

# Check container health
docker inspect whatsapp-bot | grep Health -A 10
```

## 🚀 Production Deployment

### Railway Deployment

1. **Connect your repository to Railway**
2. **Set environment variables in Railway dashboard**
3. **Deploy automatically on push to main branch**

### Heroku Deployment

1. **Create Heroku app:**
   ```bash
   heroku create your-whatsapp-bot
   ```

2. **Set environment variables:**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set CHROMIUM_PATH=/usr/bin/chromium-browser
   ```

3. **Deploy:**
   ```bash
   git push heroku main
   ```

### Kubernetes Deployment

Create `k8s-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whatsapp-bot
spec:
  replicas: 1
  selector:
    matchLabels:
      app: whatsapp-bot
  template:
    metadata:
      labels:
        app: whatsapp-bot
    spec:
      containers:
      - name: whatsapp-bot
        image: whatsapp-bot:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        - name: CHROMIUM_PATH
          value: "/usr/bin/chromium-browser"
        volumeMounts:
        - name: whatsapp-data
          mountPath: /data
      volumes:
      - name: whatsapp-data
        persistentVolumeClaim:
          claimName: whatsapp-data-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: whatsapp-bot-service
spec:
  selector:
    app: whatsapp-bot
  ports:
  - port: 3000
    targetPort: 3000
  type: LoadBalancer
```

## 📋 Monitoring

### Health Check
- Endpoint: `GET /health`
- Interval: 30 seconds
- Timeout: 10 seconds
- Retries: 3

### Metrics
- Uptime monitoring
- Memory usage tracking
- API response times
- WhatsApp connection status

## 🔄 Updates and Maintenance

### Updating the Bot
```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose up -d --build
```

### Backup WhatsApp Session
```bash
# Backup session data
docker cp whatsapp-bot:/data/.wwebjs_auth ./backup/

# Restore session data
docker cp ./backup/.wwebjs_auth whatsapp-bot:/data/
```

## 📞 Support

For issues and questions:
- Check logs: `docker-compose logs -f whatsapp-bot`
- Health check: `curl http://localhost:3000/health`
- Container status: `docker ps`
- Resource usage: `docker stats` 