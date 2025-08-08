# Multi-stage build for TypeScript WhatsApp Bot
# Stage 1: Build stage
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for TypeScript)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Production stage
FROM node:18-alpine AS production

# Install runtime dependencies for Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    dumb-init \
    su-exec

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S whatsapp-bot -u 1001

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Copy environment file if exists
COPY .env* ./

# Copy startup script
COPY scripts/start.sh /usr/src/app/start.sh
RUN chmod +x /usr/src/app/start.sh

# Create data directory for WhatsApp session with proper permissions
RUN mkdir -p /data && \
    chown -R whatsapp-bot:nodejs /data && \
    chown -R whatsapp-bot:nodejs /usr/src/app && \
    chmod -R 777 /data

# Note: We'll switch to non-root user only if RAILWAY_RUN_UID is not set to 0
# This allows Railway volumes to work properly with root permissions

# Expose the correct port (3003 as per your .env)
EXPOSE 3003

# Health check with correct port
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3003/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Use the startup script to handle user switching
CMD ["/usr/src/app/start.sh"]
