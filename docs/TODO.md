# 待办与接手说明

> 最后更新：2026-11-12，基于 `main` 分支提交 `3b574ef` 之后的代码。
>
> 这份文档写给接手继续开发的人或 AI。每一项都写明：现状和原因、要改的文件和函数、怎么改、怎么验证、做到什么程度算完成。
> 文中的行号是写文档时的位置，代码改动后可能偏移，以函数名和文件为准。
>
> 做完一项：在本文件里删掉它（或移到文末「已完成」并注明提交），提交说明里写清楚改了什么、怎么验证的。
>
> 任何文件、提交说明、日志和截图里都不要出现真实的账号、密码、密钥、令牌或站点 key；示例一律用 `<占位符>`。

## 目录

1. 总览
2. 更新计划
3. 本地环境与测试
4. P0：通知「标为已读」后页面不更新
5. P1：把剩余的测试接入 CI
6. P1：工作台快捷键
7. P1：会话全文搜索
8. P2：依赖大版本升级
9. P2：已知的小问题
10. 踩过的坑
11. 已完成

## 1. 总览

| 优先级 | 事项 | 类型 | 主要改动位置 | 改数据库 |
| --- | --- | --- | --- | --- |
| P0 | 通知「标为已读」后页面不更新 | 缺陷 | `src/app/admin/notifications/`、`src/server/actions/account-notices.ts` | 否 |
| P1 | 把剩余的测试接入 CI | 测试 | `.github/workflows/ci.yml`、`scripts/ai-queue-e2e.mjs` | 否 |
| P1 | 工作台快捷键 | 功能 | `src/app/agent/`、`src/components/agent/` | 否 |
| P1 | 会话全文搜索（按消息内容搜） | 功能 | `src/server/services/conversation-queries.ts`、工作台会话列表、新迁移 | 是，只加索引 |
| P2 | 依赖大版本升级（Next 16、Prisma 7 等） | 维护 | `package.json`、Prisma 和 Next 相关代码、Dockerfile | 视 Prisma 7 而定 |
| P2 | 已知的小问题 | 缺陷 | 见第 9 节 | 否 |

## 2. 更新计划

每一项单独开分支、单独提 PR；CI 全绿并合并之后再开始下一项。建议顺序：

1. **P0「标为已读」**。修好后把 `e2e:collection` 移回 CI 的普通分组。从此所有浏览器验收都必须通过，后面每一步才有可靠的回归保护。
2. **把剩余的测试接入 CI**。只改 CI 和测试，改动小；越早接入，后面的功能开发越早发现回归。
3. **工作台快捷键**。纯前端，不改接口和数据库，是风险最低的功能项。
4. **会话全文搜索**。分两期：第一期在服务端按消息内容搜索，列表里显示命中片段（带一个只加索引的迁移）；第二期点击结果跳到命中的那条消息。
5. **依赖升级**。一次只升一个大版本，顺序：小版本 → `@types/node` → Prisma 7 → Next 16 → ESLint 10 → TypeScript 7。
6. **小问题**可以穿插在任意两步之间做。

每一步完成时：

- 跑第 3 节的检查：至少 `pnpm check`、`pnpm build`，以及受影响的浏览器验收；
- 新增或改变了命令、环境变量、迁移或用户能看到的行为时，同步更新 `README.md`。新迁移要写明它做什么、是否改数据、对大表的影响（参考 README 里 `z25_lookup_indexes` 那段）；
- 更新本文件。

## 3. 本地环境与测试

### 3.1 常用检查

```bash
pnpm install --frozen-lockfile
pnpm check     # 类型检查 + ESLint + 隔离单元测试，不需要数据库
pnpm build     # 生产构建
```

ESLint 配置忽略了 `scripts/` 目录。改了测试脚本后，至少运行 `node --check scripts/<文件>.mjs` 检查语法，并实际跑一遍这个脚本。

### 3.2 浏览器验收

写入类测试必须连接**专用的临时数据库**，不能指向日常使用或生产的数据库：测试会创建和删除数据，`e2e:demo-navigation` 还会写入演示商家并且不清理。

1. 启动临时 PostgreSQL 17。把账号写进一个不提交到仓库的 env 文件（三行：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`），不要写在命令行上：

   ```bash
   docker run -d --name beesupport-e2e-pg -p 127.0.0.1:55443:5432 \
     --env-file <仓库外的 env 文件> \
     --tmpfs /var/lib/postgresql/data postgres:17-alpine
   ```

   `--tmpfs` 把数据放在内存里，速度快；但容器或 Docker 一停，数据就没了，重新启动后要重做第 3 步。新建的数据库在初始化后会自动重启一次，等 `docker exec beesupport-e2e-pg pg_isready` 连续成功几次再继续。

2. 设置环境变量，与 `.github/workflows/ci.yml` 里 `browser` 任务的 `env` 保持一致：

   | 变量 | 值 |
   | --- | --- |
   | `DATABASE_URL`、`TEST_DATABASE_URL` | 都指向第 1 步的测试库 |
   | `TEST_APP_URL`、`APP_URL` | `http://127.0.0.1:3002`。端口要空闲，测试会在这里启动应用 |
   | `ADMIN_PATH` | 以 `/` 开头的测试用后台路径，可以沿用 ci.yml 里的值 |
   | `AUTH_SECRET` | 随机生成：`node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` |
   | `ACCOUNT_E2E_BUILD` | `.next` |
   | `REDIS_URL` | 空字符串 |
   | `WECHATBOT_ENABLED` | `false` |
   | `NEXT_TELEMETRY_DISABLED` | `1` |

   Windows PowerShell 用 `$env:变量名 = "值"` 设置。

3. 准备数据库、构建和浏览器：

   ```bash
   pnpm db:generate && pnpm db:deploy && pnpm db:seed
   pnpm build
   pnpm exec playwright install chromium
   ```

4. 运行。`pnpm e2e:browser` 按顺序运行给出的套件，最后汇总每套的结果和耗时。需要应用的套件会各自启动一个新的生产服务，避免登录限流和缓存影响下一套：

   ```bash
   pnpm e2e:browser e2e:tenants e2e:growth
   pnpm e2e:browser e2e:features e2e:demo-navigation   # demo-navigation 放最后
   ```

   结果、截图和应用日志在 `test-results/<套件名>/` 下（`server.log` 是应用日志）；少数脚本把截图写到系统临时目录下的 `beesupport-*-results`。`pnpm e2e:browser` 也能运行不需要应用的脚本（例如 `test:growth`），这时它不会启动服务。

### 3.3 CI 里跑了什么

`verify` 任务：类型检查、ESLint、单元测试，空库迁移，`test:db`、`test:tenants`、`test:subscriptions`，生产构建，`test:recovery`，`e2e:accounts`、`e2e:efficiency`、`e2e:ai-queue`、`e2e:ai-policy`。

`browser` 任务（四组并行，每组有自己的临时数据库）：

| 组 | 套件 |
| --- | --- |
| agents | `e2e:deliveries` `e2e:canned` `e2e:reporting` `e2e:follow-ups` `e2e:auto-follow-ups` `e2e:unanswered` `e2e` `e2e:frontend` |
| merchants | `e2e:features` `e2e:analytics-images` `e2e:tenants` `e2e:subscriptions` `e2e:home-launchers` |
| platform | `e2e:growth` `e2e:operations` `e2e:demo-navigation` |
| known-issues | `e2e:collection`（允许失败，见第 4 节） |

每组的截图和日志作为 `browser-<组名>` 工件保留 7 天，结果表格写在任务摘要里。

## 4. P0：通知「标为已读」后页面不更新

### 现状

- 现象：后台「通知」页（`<ADMIN_PATH>/notifications`）点某条通知的「标为已读」后，数据库里的 `readAt` 已经写入，但页面上这条通知仍显示「未读」，「标为已读」按钮也还在。整页刷新后显示正确。
- 重现：按第 3 节准备好环境后运行 `pnpm e2e:browser e2e:collection`。失败的用例是 `scripts/collection-e2e.mjs` 第 423 行「商家审核结果通知、已读及隐私隔离，关闭收款展示保留配置」：第 441 行点击按钮，第 454 行等待「已读」出现，20 秒后超时。
- CI：这套测试单独放在 `known-issues` 组，job 设置了 `continue-on-error`，失败不会让工作流失败。

### 代码路径

- 页面 `src/app/admin/notifications/page.tsx`：`force-dynamic`，服务端查询，每页 20 条。每条通知是一个 `<article>`，标题里有「已读/未读」标签；未读的通知渲染 `<NoticeButtons id={notice.id} />`，页面顶部还有一个不带 id 的「全部标为已读」。
- 按钮 `src/app/admin/notifications/notice-buttons.tsx`：点击后 `setPending(true)`（按钮显示「处理中…」）→ `await callClientAction(() => markNoticesReadAction(id))` → `setPending(false)` → 失败时 `toast.error`，成功时 `router.refresh()`。
- 服务端动作 `src/server/actions/account-notices.ts` 的 `markNoticesReadAction`：`updateMany` 写入 `readAt`，然后 `revalidatePath("/admin", "layout")`；`ADMIN_PATH` 不是 `/admin` 时再 `revalidatePath(ADMIN_PATH, "layout")`。自定义 server（`server.ts`）把公开的后台路径改写到 `/admin` 下渲染，所以两个路径都要刷新。
- `src/lib/client-action.ts` 的 `callClientAction` 只把抛出的异常转成 `{ ok: false, error }`，没有超时。

### 已经确认的事实

- 数据库里 `readAt` 已经写入（测试轮询数据库确认）。
- 应用日志：这个 POST 约 29 ms 返回 200，请求没有被中断。日志记录的可能只是响应头发出的时间。
- 动作之后的刷新请求（带 `_rsc` 参数的 GET）也返回 200。
- 浏览器直到测试超时、关闭上下文时才把这个 POST 记为 `net::ERR_ABORTED`，说明浏览器一直没有收完动作响应的正文。
- 失败时按钮文字是「标为已读」而不是「处理中…」，也就是 `await` 已经返回（或者组件被重新挂载过）。
- 页面没有抛出错误（`pageerror` 为空）。
- 以下情况都同样失败，因此都不是原因：换回升级前的依赖（Next 15.5.28 / React 19.1.0）；全新的数据库；去掉 `router.refresh()`。
- 还没解释的一点：在提交 `40dff3a` 上，这条用例在本地曾连续通过两次，之后一直失败。

### 下一步怎么查

按顺序做，每一步都能把范围缩小一半：

1. **看动作响应的正文有没有结束。** 在测试里拿到这个 POST 的 `response` 后，执行 `await Promise.race([response.finished(), <5 秒超时>])`。一直不结束，说明服务端渲染的流没有关闭（例如某个 Suspense 一直挂起），去查 `revalidatePath` 之后重新渲染的布局；能结束，就是客户端没有把结果应用上，继续第 2 步。
2. **看刷新拿到的数据。** 记录带 `_rsc` 参数的 GET 的响应正文，在其中找这条通知的订单号附近是「已读」还是「未读」。是「未读」，说明服务端渲染出的数据是旧的，查缓存；是「已读」，说明客户端没有把新的页面树应用上，查路由。
3. **收集客户端日志。** 监听 `page.on("console")`，并用 `page.addInitScript` 注册 `unhandledrejection` 监听，找 Next 输出的 `SERVER ACTION APPLY FAILED` 之类信息；同时看失败时有没有出现「操作失败，请重试」的提示。再用 `pnpm dev` 连同一个测试库手动重现一次，开发模式的报错更完整。
4. **只保留一个 `revalidatePath`。** 先去掉 `revalidatePath(ADMIN_PATH, "layout")`，再试只保留它，看哪种情况页面能更新。同时确认动作响应里的页面树和浏览器当前的路由树是否对应同一组路径段（公开路径被改写成 `/admin` 后才交给 Next）。
5. **对照其他页面。** 后台还有 28 个文件在服务端动作后调用 `router.refresh()`。挑一两个（例如商家、订单页面的按钮）做同样的操作：它们也不更新，问题在公共路径改写或布局；它们正常，问题在通知页本身。
6. **排除主题改动。** 提交 `62be477` 改了 `src/app/layout.tsx` 里的主题脚本。用 `git worktree add` 建一个单独的目录，在里面 `git revert --no-commit 62be477`，重新 `pnpm install` 和 `pnpm build` 后运行这条用例。
7. 还找不到时，用 `git bisect` 配合 `pnpm e2e:browser e2e:collection` 找到引入问题的提交（每一步都要重新 `pnpm build`）。`scripts/collection-e2e.mjs` 第 209–248 行演示了怎样从真实点击里拿到 `next-action` 编号并直接重放动作，重放时可以直接读响应正文。

在找到根因之前，不要用「动作成功后 `window.location.reload()`」或乐观更新来掩盖它：同样的问题可能也存在于其他页面。

### 完成标准

- 在全新数据库上，`pnpm e2e:browser e2e:collection` 连续通过 3 次。
- `.github/workflows/ci.yml`：把 `e2e:collection` 移到 `platform` 组（放在 `e2e:demo-navigation` 之前），删除 `known-issues` 组和它上面的注释，以及 job 上的 `continue-on-error` 一行。
- `README.md`：删除 CI 段落里关于 `known-issues` 组的那句。
- 如果根因不只影响通知页，为受影响的其他页面补一条浏览器回归。

## 5. P1：把剩余的测试接入 CI

### 现状

以下脚本仓库里有，但 CI 没有运行，可能已经和代码脱节（浏览器验收接入 CI 时就发现过两处过时的断言）：

| 命令 | 脚本 |
| --- | --- |
| `pnpm test:analytics-images` | `scripts/analytics-images-db.mjs` |
| `pnpm test:growth` | `scripts/growth-db.mjs` |
| `pnpm test:collection` | `scripts/collection-db.mjs` |
| `pnpm test:operations` | `scripts/operations-db.mjs` |
| `pnpm test:accounts` | `scripts/account-access-db.mjs` |
| `pnpm test:deliveries` | `scripts/deliveries-db.mjs` |
| `pnpm smoke` | `scripts/smoke-admin-data.mjs` |

另外，`scripts/ai-queue-e2e.mjs` 约第 85 行切换到暗色主题后立刻做完整的 wcag2a/wcag2aa 扫描，没有等页面动画结束。它目前在 CI 里能通过，但和接入时 `e2e:tenants` 出现的对比度误报是同一种情况，可能偶发失败。

### 怎么改

1. 按第 3 节准备测试库，逐个在本地运行上表的命令，记下耗时，以及它是否需要应用实例、浏览器或邮件接收器（`analytics-images-db.mjs` 第 47 行设置了浏览器语言，可能会启动浏览器）。失败的先修：分清是测试过时（功能有意改动过，用 `git log -S` 查）还是真实回归。
2. 每个脚本都要能在空库上重复运行（自己创建、自己清理数据）。
3. 只需要数据库的，加到 `ci.yml` 的 `verify` 任务，放在 `pnpm test:subscriptions` 后面；需要浏览器或应用的，加到 `browser` 任务里合适的组，写在该组 `suites` 的前面（`pnpm e2e:browser` 可以运行任何 package.json 脚本）。
4. 在 `scripts/ai-queue-e2e.mjs` 的这次扫描前加 `await waitForSettledPage(page)`（从 `./browser-test-helpers.mjs` 导入）。

### 验证

推到自己的分支，确认 CI 全绿；再临时改坏其中一个断言，确认 CI 会变红，然后改回。

### 完成标准

上表 7 个命令都在 CI 中运行并通过；README 的 CI 段落同步更新。

## 6. P1：工作台快捷键

### 现状

工作台（`/agent`）没有全局快捷键，只有几个输入组件各自处理按键：

- `src/components/agent/workbench-composer.tsx` 约 133–153 行：回车发送、Shift+回车换行；输入法选字时（`isComposing` 或 `keyCode === 229`）回车不发送；草稿为空时输入 `/` 打开快捷话术。
- `src/components/agent/canned-reply-picker.tsx` 约 73 行：快捷话术选择器自己的按键处理。
- `src/components/agent/visitor-conversation-fields.tsx` 约 106 行：访客字段输入框自己的按键处理。

客服只能用鼠标切换会话、找搜索框、关闭面板。

### 建议的按键

先和产品确认，避免和浏览器、输入法冲突：

| 按键 | 作用 | 焦点在输入框里时 |
| --- | --- | --- |
| `Ctrl+K`（Mac 上 `⌘K`） | 聚焦会话搜索框并全选 | 也生效 |
| `Alt+↓` / `Alt+↑` | 切到筛选后列表里的下一个 / 上一个会话 | 不生效（Mac 的输入框里 `Alt+↑/↓` 用来移动光标） |
| `Esc` | 关闭最上层的面板或弹层；没有弹层时让输入框失焦 | 生效；组件自己处理过 `Esc` 时不再重复处理 |
| `?` | 打开快捷键说明 | 不生效 |

### 怎么改

1. 新建 `src/components/agent/use-workbench-shortcuts.ts`，导出一个 hook：在 `window` 上注册一次 `keydown`，卸载时移除。规则：
   - `event.isComposing || event.keyCode === 229` 时直接返回（输入法）；
   - `event.defaultPrevented` 时返回（组件自己处理过了）；
   - 焦点在 `input`、`textarea`、`select` 或 `[contenteditable]` 里时，只处理 `Ctrl/⌘+K` 和 `Esc`；
   - 有模态对话框打开（`[role="dialog"][aria-modal="true"]`）时不切换会话；
   - 用 `event.key` 判断（`"?"`、`"ArrowDown"`、`"k"`），不要用 `keyCode`，也不要假设 `?` 一定是 Shift+/（键盘布局不同）。
2. 在 `src/app/agent/agent-workbench.tsx` 里调用这个 hook。需要的状态都在这一层或 `src/app/agent/agent-workbench-view.tsx`：当前选中的会话（`activeId`，约 66–68 行）、切换会话的函数（`selectConversation`，view 约 43 行）、筛选后的会话列表（`filterConversations` 的结果，见 `src/components/agent/conversation-list-filter.ts`）。
3. 搜索框在 `src/components/agent/conversation-list-filters.tsx` 约 71 行，给它加 `ref`（通过属性传下去）；切换会话后，让列表里的选中项 `scrollIntoView({ block: "nearest" })`。
4. 快捷键说明：在工作台头部加一个「快捷键」按钮，打开一个对话框（复用 `src/components/ui/` 里现有的对话框组件），列出所有按键；`?` 打开同一个对话框，关闭后焦点回到原来的位置。
5. 不要改账号 e2e 依赖的元素 id、按钮名称和 role。

### 验证

- 在 `scripts/frontend-e2e.mjs` 里加用例：
  - 按 `Control+K` 后搜索框获得焦点；
  - 焦点不在输入框时，按 `Alt+ArrowDown` 后选中的会话变成下一个；
  - 焦点在消息输入框里时，按 `Alt+ArrowDown` 不切换会话；
  - 派发一个 `keyCode` 为 229 的 `keydown` 不会触发任何快捷键；
  - 快捷话术打开时按 `Escape` 能关闭它，焦点回到输入框；
  - 按 `?` 打开说明，对话框可以用键盘关闭。
- 手动：用中文输入法在消息输入框里打字、选字、按回车，确认不发送、不切换会话。

### 完成标准

上面的用例通过；README 的工作台说明里列出快捷键。

## 7. P1：会话全文搜索

### 现状

- 工作台（`/agent`）的搜索只过滤已经加载到浏览器里的会话：首屏只加载 50 条（`src/app/agent/page.tsx` 约 30 行），过滤函数 `filterConversations`（`src/components/agent/conversation-list-filter.ts`）只匹配访客邮箱、称呼、最后一条消息预览和主题。
- 后台「会话」页（`src/app/admin/conversations/page.tsx` 约 37 行）和接口 `GET /api/agent/conversations?query=`（`src/app/api/agent/conversations/route.ts`）在服务端调用 `listConversations`（`src/server/services/conversation-queries.ts` 约 103–166 行），也只匹配这四个字段（`contains`、不区分大小写，关键词截到 200 字）。
- 结果：只出现在历史消息里的内容（例如「上周有个访客问过退款」）搜不到。
- `Message.body` 没有能支持模糊搜索的索引（`prisma/schema.prisma` 的 `model Message` 只有 `[conversationId, createdAt]` 和 `[authorId]` 两个索引），直接 `ILIKE '%词%'` 会扫描整张消息表。

### 第一期：能按消息内容搜到会话

1. **迁移。** 新建 `prisma/migrations/z26_message_body_search/migration.sql`：

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX "Message_body_trgm_idx" ON "Message" USING GIN ("body" gin_trgm_ops);
   ```

   在 `prisma/schema.prisma` 的 `model Message` 里声明同一个索引，否则以后 `prisma migrate dev` 会认为数据库和 schema 不一致，生成一个删除它的迁移：

   ```prisma
   @@index([body(ops: raw("gin_trgm_ops"))], type: Gin, map: "Message_body_trgm_idx")
   ```

   在 schema 里声明扩展需要开启 `postgresqlExtensions` 预览特性；不想开的话，扩展只在迁移 SQL 里创建就行。改完用 `pnpm prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <测试库地址>` 确认没有差异。

   **大表注意：** 普通的 `CREATE INDEX` 在建索引期间会挡住 `Message` 表的写入。要不停机，就改用 `CREATE INDEX CONCURRENTLY`，但它必须是迁移文件里唯一的一条语句（同一个文件里的多条语句会在一个隐式事务里执行），扩展要放到前一个迁移里创建。三字组索引的体积可能是消息正文总量的数倍，升级前确认磁盘空间。

   **中文先验证：** pg_trgm 把文本切成三个字符一组，是否把汉字当作「字母」取决于数据库的字符分类设置（LC_CTYPE）。先在目标数据库执行 `SELECT show_trgm('申请退款');`：返回空数组，说明汉字进不了索引，这个方案对中文无效。另外，关键词少于 3 个字（例如「退款」）时提取不出三字组，查询会退化成扫描整个索引；中文搜索两个字的情况很常见，要用真实规模的数据测一下耗时。如果不能接受，再评估 `pg_bigm` 扩展（按两个字切分，适合中日韩文字，但不是每个托管数据库都提供）。

2. **服务端。** 给 `listConversations` 加一个选项（例如 `searchMessages: true`）。关键词不为空且开启这个选项时，在已有的 `where.OR` 里追加：

   ```ts
   { messages: { some: { body: { contains: query, mode: "insensitive" } } } }
   ```

   确认它和原有的站点、商家权限条件是「并且」的关系，不能让 OR 绕过权限。客服能看到内部备注，所以备注（`type: "NOTE"`）也参与搜索；访客侧的接口不要接这个选项。

   命中片段：对返回的这一页会话，再查每个会话里最新的一条命中消息，返回 `matchedMessage: { id, createdAt, snippet }`。`snippet` 在服务端截取关键词前后约 30 个字，不要把整条消息发给前端。用 `DISTINCT ON ("conversationId")` 的原生 SQL 一次查完（`prisma.$queryRaw` 的模板写法传参，不要拼接字符串），不要每个会话查一次。

   `src/app/api/agent/conversations/route.ts` 读取 `searchMessages=1` 参数并传下去；后台「会话」页的搜索直接开启。

3. **工作台。**
   - 搜索框（`src/components/agent/conversation-list-filters.tsx`）输入停止 300 ms 后，关键词至少 2 个字时请求 `GET /api/agent/conversations?query=<关键词>&searchMessages=1`。用 `AbortController` 取消上一次请求，只显示最后一次请求的结果。
   - 搜索结果单独显示在一个「搜索结果」区域，不要并入实时推送维护的会话列表：实时事件会更新列表，而搜索结果是一次性的快照。清空关键词后恢复原来的本地过滤。
   - 片段里高亮关键词：把字符串按关键词拆开，命中部分包 `<mark>`。不要用 `dangerouslySetInnerHTML`，消息内容是访客输入的。

### 第二期：点击结果跳到那条消息

- 现在的历史消息只能从最新往前翻：`src/server/services/message-read.ts` 的 `listConversationMessages({ conversationId, limit, before })` 以消息 id 为游标，每次最多 200 条；会话详情由 `src/server/services/conversation-action-detail.ts` 加载。
- 给 `listConversationMessages` 加一个 `around: messageId` 选项（取这条消息前后各 50 条）；消息列表要支持「加载更新的消息」（现在只能加载更早的）；打开会话后滚动到这条消息并短暂高亮。
- 这一期会把消息列表的分页从单向改成双向，改动面大，可以单独排期。

### 验证

- 数据库测试（`tests/database/`）：两个商家各有一条包含相同关键词的消息，客服只能搜到自己有权限的站点下的会话；关键词里有 `%`、`_`、`\` 时按字面匹配；关键词前后的空格先去掉。
- 浏览器验收（`scripts/frontend-e2e.mjs`）：发一条包含特殊词的消息，再发几条别的消息，让它不在「最后一条消息预览」里；在工作台搜索这个词，能看到这个会话和高亮的片段。
- 性能：在测试库里批量插入约 100 万条消息，对搜索 SQL 执行 `EXPLAIN (ANALYZE, BUFFERS)`，确认 3 个字以上的关键词用到了 `Message_body_trgm_idx`；记录 2 个字的关键词的耗时。

### 完成标准

工作台和后台「会话」页都能按消息内容搜到会话，并显示命中片段；权限测试通过；README 写明 `z26` 迁移的作用、建索引对大表写入的影响，以及中文短关键词的限制。

## 8. P2：依赖大版本升级

### 现状

2026-11-12 运行 `pnpm outdated` 的结果：

| 包 | 当前 | 最新 | 说明 |
| --- | --- | --- | --- |
| `next`、`eslint-config-next` | 15.5.29 | 16.4.6 | |
| `@prisma/client`、`prisma` | 6.19.3 | 7.10.1 | `prisma` 的 latest 标签指向 8.0.0-rc.33（预发布版），目标用 7.x 稳定版，两个包版本保持一致 |
| `eslint` | 9.39.5 | 10.14.0 | |
| `typescript` | 5.6.2 | 7.0.2 | |
| `@types/node` | 20 | 26 | 应和运行时 Node 24 对应，升到 24.x，不是最新 |
| `cross-env` | 7 | 10 | |
| `@hookform/resolvers` | 5.9.1 | 7.0.5 | |
| `@axe-core/playwright` | 4.11.1 | 4.14.0 | 小版本 |
| `playwright` | 1.64.1 | 1.65.0 | 小版本 |
| `cn` | 0.4.0 | 0.5.2 | 0.x 版本的小版本也可能不兼容 |

`pnpm audit` 还剩两组提示：`deepmerge-ts`（来自 Prisma CLI）和 `glob` / `minimatch`（来自 ESLint 的依赖），分别随 Prisma 7 和 ESLint 10 的升级解决。

`pnpm-workspace.yaml` 里有一条 `overrides`，把 `postcss` 提到 8.5.32 以上（Next 15 固定依赖有安全公告的 8.4.31）。升级 Next 后用 `pnpm why postcss` 确认，不再需要就删掉。

### 顺序和要点

各大版本的变化以官方升级指南为准，下面只列出本项目里要重点检查的地方。

1. **小版本**：`pnpm up @axe-core/playwright playwright cn`，跑 `pnpm check` 和全部浏览器验收。
2. **`@types/node` 升到 `^24`**：跑 `pnpm typecheck`。
3. **Prisma 7**：新的生成器、需要指定输出目录、连接改用驱动适配器（PostgreSQL 用 `@prisma/adapter-pg`）、配置移到 `prisma.config.ts`、不再自动读取 `.env`。本项目要改：
   - `prisma/schema.prisma` 的 `generator client`（现在是 `prisma-client-js`）；
   - `src/lib/db.ts`（创建 `PrismaClient` 的地方，自定义 server 和 Next 路由共用一个实例）；
   - 所有从 `@prisma/client` 导入类型或枚举的地方（`git grep -n "@prisma/client"`）；
   - `package.json` 里的 `build`、`typecheck`、`db:*` 脚本（都调用了 `prisma generate` 或迁移命令）；
   - `Dockerfile`：它复制 `prisma/` 目录，启动命令里运行 `prisma migrate deploy`，还为 Alpine 上的查询引擎安装了 openssl。改用 `prisma.config.ts` 后镜像里也要带上这个文件；不再使用旧查询引擎时，openssl 那一步可以评估去掉；
   - `scripts/` 和 `tests/database/` 里直接创建 `PrismaClient` 的测试脚本；
   - 环境变量的读取：运行时和迁移命令都要能拿到 `DATABASE_URL`。

   验证：`pnpm check`、`pnpm test:db`、第 5 节的数据库测试、`pnpm test:recovery`；构建 Docker 镜像并启动后，`GET /api/health/ready` 返回 200。
4. **Next 16**：先运行官方 codemod（`npx @next/codemod@latest upgrade`），再检查：
   - `cookies()`、`headers()`、`params`、`searchParams` 只能异步访问（Next 15 的同步兼容层被移除）；
   - `revalidateTag` 的参数变化（`git grep -n "revalidateTag("`）；
   - 构建默认改用 Turbopack，`next.config.ts` 里的 webpack 配置和实验选项（`staleTimes`、`optimizePackageImports` 等）要逐项确认；
   - 自定义 server（`server.ts`）依赖的 Next 内部行为：`globalThis.AsyncLocalStorage` 基线，以及把公开后台路径改写到 `/admin`；
   - 项目没有 `middleware.ts`，`lint` 脚本用的是 `eslint .` 而不是 `next lint`，Next 16 在这两处的变化不影响本项目。

   验证：`pnpm build`、全部浏览器验收；手动检查后台入口、实时消息（Socket.IO）、主题切换不闪烁、404 页面。
5. **ESLint 10 和 `eslint-config-next` 16**：一起升。先确认 `eslint-config-next` 16 声明支持 ESLint 10。
6. **TypeScript 7**：等 Next 和 typescript-eslint 宣布支持后再升；可以先在分支上试 `tsc --noEmit`。
7. **`@hookform/resolvers` 7、`cross-env` 10**：读各自的变更日志。`cross-env` 只在 package.json 脚本里用到。

每升一步跑一次 `pnpm audit`，并更新本节的表格。

## 9. P2：已知的小问题

### 9.1 商家卡片的到期判断可能导致水合不一致

- 现状：`src/app/admin/merchants/merchant-card.tsx` 是客户端组件，第 24 行在渲染时用 `new Date(tenant.expiresAt) <= new Date()` 判断是否显示「已到期」。服务端渲染和浏览器水合发生在不同时刻，临近到期时两边结果可能不同，React 会报 #418（文本不一致）。
- 改法：在服务端（调用它的页面）算好 `expired` 布尔值，作为属性传入。
- 验证：把一个测试商家的到期时间设为几秒后，在这个时间点前后打开商家列表，控制台没有 #418。

### 9.2 嵌入代码的「安装」统计在同一站点下会漏记

- 现状：`src/components/widget/use-widget-tracking.ts`（约 77–116 行）只有浏览器里没有访客身份令牌时才上报「安装」；`src/app/api/widget/visit/route.ts` 的 `recordSiteEmbed`（约 60 行）因此只在新访客第一次加载时记录。同一个浏览器先访问过这个站点的其他页面（或后台预览）后，新嵌入的页面只记「访问」，不记「安装」。
- 改法：安装记录与访客身份无关。每次加载都带上嵌入页面的来源，服务端按「站点 + 来源」去重（已有记录就跳过，可以在进程内缓存最近见过的组合，减少数据库查询），速率限制沿用现有的匿名上报限制。
- 验证：`e2e:growth` 现在用干净的浏览器上下文来规避这个问题；修好后加一个复用上下文的用例。

### 9.3 构建时会访问数据库

- 现状：`pnpm build`（以及 Docker 构建）的日志里有 8 条 `Can't reach database server` 和 `mail.settings_load_failed`。构建本身成功，但说明有页面在构建期的静态预渲染里调用了 `src/lib/mail.ts` 的 `getSmtpConfig()`。
- 改法：用 `git grep -n "getSmtpConfig"` 找到在页面渲染中调用它的路由，给这些路由加 `export const dynamic = "force-dynamic"`，或者把调用挪到请求处理里。
- 验证：在没有数据库的环境里运行 `pnpm build`，日志里没有这些错误。

### 9.4 `e2e:collection` 偶发 React #418（HTML 不一致）

- 现状：出现过一两次，没能确定是哪个页面。测试脚本的 `pageerror` 输出现在会带上页面路径。
- 下次出现时，按路径找到页面，查渲染时依赖当前时间、随机数或浏览器环境的代码（9.1 就是这一类）。

## 10. 踩过的坑

- **流式渲染 + 入场动画 vs. 无障碍扫描。** 页面内容通过 Suspense 分批出现并带淡入动画，axe 在动画中途扫描会误报对比度不足。扫描前调用 `scripts/browser-test-helpers.mjs` 的 `waitForSettledPage(page)`（等网络空闲，并等 `document.getAnimations()` 全部结束，包括 CSS transition）；改了视口尺寸后也要再等一次。
- **next-themes 和流式渲染。** next-themes 和流式渲染一起用时，水合会丢掉已经流式到达的内容。提交 `62be477` 已经换成项目自己的实现（`src/lib/theme.ts`、`src/components/use-theme.ts` 和 `src/app/layout.tsx` 里的内联脚本），原因见该提交的说明。不要再引入 next-themes。
- **相对时间引起的水合报错。** 「3 分钟前」这类文本在服务端和浏览器渲染的时刻不同，React 19 会报 #418。只影响单个元素的文本时，给这个元素加 `suppressHydrationWarning`（工作台的会话头部、会话列表项和访客资料已经这样处理）；影响判断逻辑的（如 9.1）要放到服务端算。
- **Playwright 定位器。** `getByText` 和 CSS 选择器会把隐藏元素也算进去（`getByRole` 默认排除隐藏元素），桌面和手机布局各渲染一份时会触发 strict mode 冲突。带 `list` 属性的 `<input>` 的 role 也是 `combobox`，对话框里同时有它和 `<select>` 时，`getByRole("combobox")` 要加上 `name`。
- **同一站点会复用浏览器存储。** 同一个浏览器上下文里，嵌入脚本会复用访客身份。需要「第一次来」的效果时，用 `browser.newContext()` 开一个干净的上下文（见 9.2）。
- **测试要指定中文。** 页面语言按浏览器语言决定；断言中文文案的测试要用 `browser.newContext({ locale: "zh-CN" })`。
- **tmpfs 测试库。** 容器或 Docker 停止后数据全部丢失，重启容器后要重新 `db:deploy` 和 `db:seed`；新数据库初始化后会重启一次，就绪检查要连续成功几次。
- **lockfile 和 `pnpm-workspace.yaml` 要一起动。** `overrides` 写在 `pnpm-workspace.yaml` 里，`pnpm-lock.yaml` 记录了它。回退或切换依赖时，`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 三个文件要一起改，否则 `pnpm install --frozen-lockfile` 会报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- **演示数据不清理。** `e2e:demo-navigation` 之前会运行 `demo:seed`，写入的演示商家留在库里。在同一个库里跑多套时，把它放最后。
- **测试过时，不是功能坏了。** 浏览器验收接入 CI 时，有两处断言早于对应功能的改动（例如商家管理员现在也有「AI」菜单）。测试失败时，先用 `git log -S "<关键字>"` 查相关代码最近是不是有意改过，再决定改测试还是改代码。
- **自定义 server。** 业务入口必须经过 `server.ts`（实时通道、AI 任务 worker、后台路径改写都在这里），不要用裸 `next start` 或 `next dev` 做验收。服务端动作里刷新后台页面时，`/admin` 和 `ADMIN_PATH` 两个路径都要刷新（见 `src/server/actions/account-notices.ts`）。
- **Windows PowerShell 5。** 传给原生命令（`git` 等）的参数里如果有双引号，会被吞掉；正则里可以用 `.` 代替引号。`for` 循环不能直接接管道，先赋值给变量再接。

## 11. 已完成

（做完一项后移到这里，注明提交号。）
