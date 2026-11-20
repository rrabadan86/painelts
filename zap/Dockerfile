# Robô do WhatsApp das campanhas: Node + whatsapp-web.js + Chromium do próprio Debian
# (o Chrome que o puppeteer baixaria sozinho fica de fora: PUPPETEER_SKIP_DOWNLOAD).
FROM node:22-bookworm-slim
ENV TZ=America/Sao_Paulo \
    NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js sessoes.js wa.js ./
EXPOSE 8010
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8010/saude',{headers:{'X-Zap-Token':process.env.ZAP_TOKEN||''}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
