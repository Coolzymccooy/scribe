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

# Copy template to a staging location; we generate the final config
# ourselves in CMD so we control exactly which variables get substituted.
COPY nginx.conf /etc/nginx/nginx.conf.template

EXPOSE 80

# BACKEND_URL must be provided at runtime, e.g.:
#   docker run -e BACKEND_URL=https://api-scribe.tiwaton.co.uk scribe-frontend
# In Coolify: set it as an environment variable on the service.
#
# We call envsubst with an explicit variable list ('${BACKEND_URL}') so that
# ONLY ${BACKEND_URL} is substituted. All other nginx $variables ($host,
# $uri, $request_uri, $backend, etc.) are left intact as nginx expects them.
CMD ["/bin/sh", "-c", \
  "envsubst '${BACKEND_URL}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf && \
   nginx -t 2>&1 && \
   exec nginx -g 'daemon off;'"]
