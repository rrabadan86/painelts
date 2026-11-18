FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    CONFIG_FILE=/app/config/lojas.json \
    DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY scripts ./scripts
COPY public ./public
COPY demo ./demo
COPY config/lojas.exemplo.json ./config.exemplo/lojas.exemplo.json
RUN mkdir -p /app/config /data && chown -R node:node /app/config /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server.js"]
