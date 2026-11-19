# BeeSupport 多站点客服

在多个网站嵌入客服窗口，用同一个工作台接待访客。BeeSupport 支持实时聊天、文件上传、离线留言、会话分配与转接、快捷话术、通知、统计和 AI 辅助回复。

[GitHub Releases](https://github.com/Creator2K/BeeSupport/releases) · [使用与开发参考](docs/reference.md) · [备份、恢复与发布手册](docs/recovery-and-release.md)

## 从空服务器部署

已发布的 `v0.1.3` 镜像支持 Linux x86_64（`amd64`）。请在服务器上安装 Docker Engine、Compose 插件、`curl` 和 `openssl`。1Panel 可在同一台服务器上配置域名、HTTPS 和反向代理。[Docker 安装文档](https://docs.docker.com/engine/install/) · [Compose 安装文档](https://docs.docker.com/compose/install/linux/)

首次启动会运行三个服务。`app` 包含前端页面、平台后台、API 和 Socket.IO；PostgreSQL 和 Redis 各有自己的容器。上传文件、数据库与 Redis 数据保存在 Compose 数据卷中。

### 1. 下载 Compose 文件

```bash
docker compose version
mkdir -p /opt/beesupport
cd /opt/beesupport
curl -fL https://raw.githubusercontent.com/Creator2K/BeeSupport/v0.1.3/docker-compose.yml \
  -o docker-compose.yml
```

镜像地址是 `ghcr.io/creator2k/beesupport:v0.1.3`。如果拉取时出现 `unauthorized`，在 GitHub 的 **Packages → beesupport → Package settings** 核对镜像包的可见性。GHCR 的公开镜像允许匿名拉取。若保留私有镜像，用 `docker login ghcr.io -u 你的GitHub用户名` 登录，在密码提示处输入含 `read:packages` 权限的经典访问令牌。[GitHub 容器仓库文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

### 2. 生成首次安装配置

把 `https://chat.example.com` 换成实际域名。以下命令会保留目录里已有的 `.env`。

```bash
if [ ! -e .env ]; then
  (
    umask 077
    cat > .env <<EOF
APP_IMAGE=ghcr.io/creator2k/beesupport:v0.1.3
APP_URL=https://chat.example.com
POSTGRES_PASSWORD=$(openssl rand -hex 24)
AUTH_SECRET=$(openssl rand -hex 48)
ADMIN_PATH=/console-$(openssl rand -hex 8)
EOF
  )
fi
```

常用配置见 [`.env.example`](.env.example)。应用端口默认发布在 `127.0.0.1:3000`。若宿主机端口已占用，可设置 `APP_PORT=3001`，并同步修改反代和下文健康检查的端口。

### 3. 拉取并启动

```bash
docker compose pull &&
docker compose up -d --no-build --wait --wait-timeout 180 &&
curl -fsS http://127.0.0.1:3000/api/health/ready
```

应用容器启动时会自动执行数据库迁移。健康检查返回 `status: ok` 后即可初始化账号。若启动失败，使用 `docker compose ps` 查看状态，再用 `docker compose logs --tail=100 app postgres redis` 查看原因。

### 4. 创建首个平台管理员

在部署目录用 Bash 执行下面的命令。密码输入时不回显。命令只创建平台管理员，适合正式空库。

```bash
read -rp '管理员邮箱: ' ADMIN_EMAIL
IFS= read -rsp '管理员密码（至少 12 个字符）: ' ADMIN_PASSWORD
printf '\n'
export ADMIN_EMAIL ADMIN_PASSWORD

docker compose exec -T -e ADMIN_EMAIL -e ADMIN_PASSWORD app node - <<'NODE'
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const db = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email.includes("@") || password.length < 12 || Buffer.byteLength(password) > 72) {
    throw new Error("请填写有效邮箱，密码至少 12 个字符且不超过 72 字节。");
  }
  if (await db.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } })) {
    throw new Error("平台管理员已存在。");
  }
  await db.user.create({
    data: { email, name: "平台管理员", passwordHash: await bcrypt.hash(password, 10), role: "ADMIN" },
  });
  console.log("平台管理员已创建");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
NODE
unset ADMIN_EMAIL ADMIN_PASSWORD
```

### 5. 接入 1Panel 和网站

1. 将域名解析到服务器，在 1Panel 为域名配置 HTTPS，把请求反代到宿主机的 `http://127.0.0.1:3000`。检查 `/socket.io/` 支持 WebSocket 升级，且反代传递原始 `Host` 和 `X-Forwarded-Proto`。手工配置见[反向代理示例](docs/reference.md#反向代理注意)。
2. 运行 `grep '^ADMIN_PATH=' .env` 查看后台入口，访问 `APP_URL` 加这个路径，用刚创建的账号登录。客服工作台在 `/agent`。
3. 在后台创建站点、填写允许接入的域名、创建或邀请客服并分配站点权限。复制后台生成的客服脚本，添加到目标网站的 `</body>` 前。[访客端接入说明](docs/reference.md#访客端接入)

在 **站点管理 → 编辑站点 → 访客窗口品牌与功能** 可开启「允许拖动悬浮按钮」。开启后，访客可以用鼠标或手指移动按钮，同一浏览器刷新后会保留位置。站点也可以继承上级配置或单独关闭拖动。

## 启用后台在线更新

已有 Compose 部署需在 Linux 服务器接入一次更新程序。它使用 systemd，只管理指定部署的 `app` 服务。以 root 身份执行，将最后的路径换成现有 Compose 目录：

```bash
curl -fL --retry 2 --connect-timeout 15 -o /root/beesupport-online-updater.sh \
  https://github.com/Creator2K/BeeSupport/releases/download/v0.1.3/online-updater.sh &&
bash /root/beesupport-online-updater.sh install /opt/beesupport
```

如果服务器无法直接下载，可以在电脑上从 [v0.1.3 发布页](https://github.com/Creator2K/BeeSupport/releases/tag/v0.1.3) 下载 `online-updater.sh`，通过 1Panel 上传到 `/root/beesupport-online-updater.sh`，再执行同一条安装命令。

如果正在运行较旧的镜像，接入命令会先拉取 `v0.1.3` 并只重建应用容器。接入后，平台管理员可以在 **平台设置 → 版本更新记录 → 在线更新** 点击「检查更新」，有新版本时点击「立即更新」。服务器下载镜像期间旧版继续运行，切换时可能短暂中断。页面会自动刷新任务状态。

更新程序通过 Docker Compose 调用应用的内部命令。应用容器无需挂载 Docker socket。部署目录及配置文件由 root 管理。日志可用安装命令最后打印的 `journalctl` 命令查看。

## 命令行更新和回退

在原部署目录编辑 `.env` 里的 `APP_IMAGE`，填入目标发布版本。已有数据库或附件的实例在应用数据库迁移前应先备份。

```bash
docker compose pull app &&
docker compose up -d --no-deps --no-build --wait --wait-timeout 180 app
```

镜像下载完成后，Compose 只切换 `app`，沿用原有数据库、Redis 和上传卷。后台右上角显示当前版本。平台管理员可点击版本号，或从 **平台设置 → 版本更新记录** 查看各版本的变更和实际部署历史。同一版本和提交连续重启只生成一条记录。

回退时把 `APP_IMAGE` 改回上一版本，然后执行相同命令。若新版本已执行数据库迁移，先确认旧版本兼容当前数据库，再按需要恢复备份。[备份与回退步骤](docs/recovery-and-release.md)

## 从源码开发与发布

源码开发使用 Node.js 24 和项目指定的 pnpm。复制 `.env.example` 为 `.env`，填入随机 `AUTH_SECRET` 后，在仓库目录执行：

```bash
docker compose up -d postgres redis
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm dev
```

`pnpm db:seed` 可为本地开发创建演示账号和示例数据。开发测试入口是 `pnpm check`，详细脚本见[使用与开发参考](docs/reference.md#验证与开发脚本)。

推送 `vX.Y.Z` 标签会触发 [GitHub Actions 镜像发布](.github/workflows/publish-image.yml)。流程构建一个应用镜像，验证启动、替换应用容器、回退与版本记录，再推送 GHCR。发布的标签和镜像版本一一对应。

## 其他文档

- [AI 策略、知识库与质量评估](docs/ai-policy-and-quality.md)
- [项目改进计划](ROADMAP.md)
