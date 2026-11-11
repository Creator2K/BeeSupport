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
# next build 会加载路由模块；签名密钥在构建命令中随机生成，不设置运行期默认值。
# 运行镜像仍由 docker compose 注入真实配置。
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    APP_URL="http://localhost:3000"
RUN AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("hex"))')" pnpm build
# 只保留运行期需要的依赖（prisma / tsx / dotenv / typescript 已放入 dependencies）。
# typescript 不能挪回 devDependencies：Next 启动时要用它加载 next.config.ts，找不到就会当场联网安装，
# 而运行用户对 /app 没有写权限，容器会启动失败
RUN pnpm prune --prod

FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache tini openssl libc6-compat && corepack enable
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    UPLOAD_DIR=/app/data/uploads
COPY --from=builder /app/node_modules ./node_modules
# Next 运行期会往 .next 里写缓存，属主交给运行用户；其余代码和依赖保持只读
COPY --from=builder --chown=node:node /app/.next ./.next
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
# 上传目录归运行用户；首次创建的数据卷会沿用这里的属主
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
# 不以 root 运行应用（基础镜像自带 node 用户，UID/GID 1000）。
# 旧镜像创建的 uploads 卷属主是 root，升级时要按 README 改一次属主
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node --import tsx server.ts"]
