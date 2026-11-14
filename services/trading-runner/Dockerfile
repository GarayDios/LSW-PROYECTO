# Build from repository root: docker build -f services/trading-runner/Dockerfile -t tepic-paper .
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY services/trading-runner ./services/trading-runner
COPY scripts/supervise-trading.mjs ./scripts/supervise-trading.mjs
COPY scripts/backup-trading.mjs ./scripts/backup-trading.mjs
RUN mkdir /data /backups /app/.sites-runtime && chown node:node /data /backups /app/.sites-runtime
USER node
ENV NODE_ENV=production TRADING_RUNNER_HOST=0.0.0.0 TRADING_RUNNER_PORT=8790 TRADING_RUNNER_DB=/data/trading-runner.sqlite TRADING_BACKUP_DIRECTORY=/backups ALPACA_AUTOMATION_ENABLED=false ALPACA_F5_AUTOMATION_ENABLED=false
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8790/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/supervise-trading.mjs"]
