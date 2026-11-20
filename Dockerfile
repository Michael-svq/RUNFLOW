# syntax=docker/dockerfile:1
# Imagen única de RunFlow: API + web. Sirve para la nube (staging/producción)
# y como base de RunFlow Station en Docker.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY apps/station/package.json apps/station/
COPY packages/db/package.json packages/db/
COPY packages/sync/package.json packages/sync/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY . .
# Clave pública de licencias de Station (opcional): se incorpora al compilar.
ARG RUNFLOW_LICENSE_PUBLIC_KEY=""
RUN pnpm --filter @runflow/web build && pnpm --filter @runflow/server build
# Solo las dependencias de producción del servidor (el resto va en el bundle).
RUN pnpm --filter @runflow/server deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web \
    DATA_DIR=/data
WORKDIR /app
# ffmpeg/ffprobe: duración y vistas previas de 05 Media
RUN apk add --no-cache ffmpeg && mkdir -p /data && chown node:node /data
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
