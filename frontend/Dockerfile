# ---- Stage 1: build ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# VITE_BACKEND_URL is intentionally left empty at build time.
# The nginx proxy rewrites /api/* to the backend, so the frontend
# uses relative paths. Override this build arg only if you want the
# frontend to call the backend directly (bypassing the nginx proxy).
ARG VITE_BACKEND_URL=""
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

RUN npm run build

# ---- Stage 2: serve ----
FROM nginx:1.27-alpine

# Copy the built Vite output
COPY --from=builder /app/dist /usr/share/nginx/html

# The official nginx image processes /etc/nginx/templates/*.template
# with envsubst at container start and writes the result to
# /etc/nginx/conf.d/default.conf — this is how BACKEND_URL is injected.
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80

# BACKEND_URL must be provided at runtime, e.g.:
#   docker run -e BACKEND_URL=https://api-scribe.tiwaton.co.uk scribe-frontend
# In Coolify: set it as an environment variable on the service.

# Run nginx config test first so any config errors appear in Coolify logs,
# then start nginx in the foreground.
CMD ["/bin/sh", "-c", "nginx -t 2>&1 && exec nginx -g 'daemon off;'"]
