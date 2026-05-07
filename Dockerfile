# RUBEN COTON Email Builder — imagen Coolify
# Sin Ollama (en VPS). Usa Gemini fallback. Auth básica con AUTH_PASSWORD.
FROM node:20-alpine

WORKDIR /app

# Sin package.json (todo es nativo Node), pero copiamos por si se añade luego
COPY package*.json ./
RUN if [ -f package.json ]; then npm install --omit=dev || true; fi

# Copiamos el resto
COPY . .

# Coolify pasará PORT por env
ENV PORT=8090
EXPOSE 8090

# Healthcheck básico
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "server.js"]
