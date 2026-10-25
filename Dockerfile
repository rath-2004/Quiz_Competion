# ---- Build the React client ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY client client
RUN npm run build -w client

# ---- Runtime: API server that also serves the built client ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev -w server && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 4000
# Applies pending migrations (and creates the admin from ADMIN_* env vars) before starting.
CMD ["sh", "-c", "node server/scripts/migrate.js && exec node server/src/index.js"]
