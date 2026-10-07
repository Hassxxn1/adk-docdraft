# Optional: for hosting on an on-premise server or any container platform.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "--no-warnings", "server.js"]
