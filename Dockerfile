FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 在没有预编译包的平台上需要编译工具
# 国内网络可通过 APT_MIRROR 换成镜像源（如 mirrors.ustc.edu.cn）加速
ARG APT_MIRROR=deb.debian.org
RUN sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY app/package*.json ./
RUN npm ci --no-audit --no-fund

COPY app/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    HOST=0.0.0.0 \
    CONTENT_DIR=/content \
    DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist-server/index.js"]
