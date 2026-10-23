# BeeSupport 生产镜像
# 说明：Next.js 走自定义 Node server（server.ts）以承载 Socket.IO 实时通道

FROM node:24-alpine AS deps
WORKDIR /app
# Prisma 在 Alpine(musl) 上需要 openssl 才能加载查询引擎
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build 会加载路由模块做静态分析，因此构建期需要一组占位环境变量。
# 注意必须用 ENV：`VAR=x cmd1 && cmd2` 里的变量只作用于 cmd1。
# 这些值只存在于 builder 阶段，运行镜像由 docker compose 注入真实配置。
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    APP_URL="http://localhost:3000"
RUN pnpm prisma generate && pnpm next build
# 只保留运行期需要的依赖（prisma / tsx / dotenv 已放入 dependencies）
RUN pnpm prune --prod

FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache tini openssl libc6-compat && corepack enable
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    UPLOAD_DIR=/app/data/uploads
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
# 自定义 server 通过 tsx 直接运行 TS 源码，因此 src 也要进运行镜像
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# 运行期不需要 Next 的构建缓存，删掉可显著减小镜像
RUN rm -rf /app/.next/cache
RUN mkdir -p /app/data/uploads
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node --import tsx server.ts"]
