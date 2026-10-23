import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 允许把构建产物写到别处（例如在不打扰 dev server 的前提下做一次验证构建）
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Prisma / Socket.IO / ioredis 必须保持为外部依赖，交给 Node 运行时加载
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "socket.io",
    "socket.io-client",
    "@socket.io/redis-adapter",
    "ioredis",
    "nodemailer",
    "bcryptjs",
    "@wechatbot/wechatbot",
  ],
  poweredByHeader: false,
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // 客户端路由缓存：30 秒内重复进入同一个后台页面直接用缓存，点哪都是秒开
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
    // 只打包用到的图标/工具函数，显著减少开发期编译开销
    optimizePackageImports: ["lucide-react", "date-fns", "radix-ui"],
  },
};

export default nextConfig;
