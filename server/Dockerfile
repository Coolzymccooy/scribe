FROM node:20-alpine

WORKDIR /app

# ffmpeg is used to normalize/re-encode incoming audio before transcription so
# malformed or interrupted recordings decode reliably (see audioNormalizer.js).
RUN apk add --no-cache ffmpeg

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Create persistent data directory for state.json
RUN mkdir -p /data

ENV PORT=3003 \
    STATE_FILE_PATH=/data/state.json \
    NODE_ENV=production

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "server.js"]
