FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY services/mongo-api ./services/mongo-api
USER node
ENV NODE_ENV=production MONGO_BRIDGE_HOST=0.0.0.0 MONGO_BRIDGE_PORT=8788
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8788/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/mongo-api/server.ts"]
