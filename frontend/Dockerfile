# ---- Stage 1: build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# VITE_BACKEND_URL is baked into the JS bundle at build time.
# In Coolify, set this as a build-time env var to the backend URL,
# e.g. https://api-scribe.tiwaton.co.uk
# The frontend calls the backend directly from the browser (no nginx proxy).
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:1.27-alpine

# Copy the built Vite output
COPY --from=builder /app/dist /usr/share/nginx/html

# Simple nginx config — just serves the SPA, no API proxy.
# API calls go directly from the browser to the backend (VITE_BACKEND_URL).
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
