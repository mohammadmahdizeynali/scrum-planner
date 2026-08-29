# Build the React app, then serve it with Caddy (TLS + static + /api proxy).
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=6 --fetch-retry-maxtimeout=60000 \
    || npm install --no-audit --no-fund --fetch-retries=6 --fetch-retry-maxtimeout=60000
COPY frontend/ .
RUN npm run build

FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv/www
