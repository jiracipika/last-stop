# LAST STOP authoritative game server.
# Any long-lived Node host works: Fly.io, Railway, Render, a VPS, k8s…
FROM node:22-slim AS base
corepack enable
WORKDIR /app

# Install workspace deps with the lockfile
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @last-stop/server... --filter @last-stop/shared...

# Sources
COPY packages/shared packages/shared
COPY apps/server apps/server

# NOTE: run via tsx — the esbuild bundle currently breaks colyseus 0.18's
# HTTP router registration (/matchmake 404s in dist/index.mjs).
ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@last-stop/server", "exec", "tsx", "src/index.ts"]
