# Clone2GHL backend — production image
FROM node:22-alpine

WORKDIR /app

# Install production deps first (better layer caching).
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source.
COPY src ./src

# Data dir (db.json + rehosted assets). Mount a persistent volume here in prod.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "src/server.js"]
