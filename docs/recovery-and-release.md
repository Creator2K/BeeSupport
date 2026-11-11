# 备份、恢复与发布

适用范围：PostgreSQL + 本地附件目录（包括 Compose uploads 卷）。工具不自动加载应用 `.env`，不删除旧备份，不覆盖数据库，不启动恢复后的应用。当前发布记录见 [ROADMAP](../ROADMAP.md)。

## 备份包含什么

一次备份是一个目录，包含 `database.dump`、`uploads/` 和最后才写入的 `manifest.json`。清单记录数据库和每个文件的 SHA-256、字节数、所有业务表行数、附件引用、Prisma 迁移历史、指定版本和备份耗时。缺少清单的目录视为未完成；不能用于恢复。

数据库使用 PostgreSQL custom 格式，包含业务数据、账号、系统设置、AI/通知任务与去重记录。附件目录整体复制，保留未关联文件和默认位于其中的微信登录凭证。数据库引用的文件必须存在且大小一致；兼容旧 Windows 附件键中的反斜杠。路径中有软链接、目录连接或大小写冲突时拒绝备份。

备份不包含应用源码/镜像、`.env`、数据库角色、TLS 证书和 Redis。发布版本应使用不可变镜像标签并记录镜像 ID；配置和密钥单独保存在受限的密码库中。若 `WECHATBOT_STORAGE_DIR` 位于附件目录之外，需另外备份它。Redis 在线状态及限流状态可以重建。

备份包含聊天内容、账号哈希、API 密钥和通知配置，应视为敏感数据。POSIX 下新备份目录权限为 700；Windows 使用仅运维账号可访问的目录 ACL。工具不加密，异机副本应使用受控的加密存储。哈希用于发现损坏，不能证明一个来源不明的备份可信；只恢复自己可信来源的备份。

## 一致性与停机窗口

先关闭入口流量，再停止**全部**应用实例、独立通知/微信进程、清理脚本及其他写入客户端，等进程退出后备份，成功后再恢复服务。`--quiesced` 表示操作者已经完成这些步骤；它本身不会停止服务。工具会检查数据库没有其他连接，并在复制前后对比数据库清单和附件内容，但无法阻止新的外部进程接入。

`pg_dump` 自身提供数据库一致性快照，文件系统不在该快照中，所以数据库和附件必须在停止写入的同一窗口内备份。[PostgreSQL pg_dump 文档](https://www.postgresql.org/docs/17/app-pgdump.html)

## 宿主机备份

需要 Node.js 20+ 和与数据库兼容的 `pg_dump`、`pg_restore`、`psql`（本项目验证 PostgreSQL 17）。通过环境变量显式设置 `RECOVERY_DATABASE_URL`，不要把带密码的连接串放在命令行参数或提交到仓库。连接串中的特殊字符需 URL 编码；允许 `schema=public`、`sslmode`、`sslrootcert`、`sslcert`、`sslkey`、`connect_timeout`。

```bash
# 已停止全部写入进程；/srv/beesupport-backups 必须已存在。
# RECOVERY_DATABASE_URL 从运维密钥存储注入。
pnpm ops:backup --uploads /srv/beesupport/data/uploads \
  --output /srv/beesupport-backups/2026-10-26-before-release \
  --release beesupport:20261026-<commit> --quiesced
pnpm ops:verify --backup /srv/beesupport-backups/2026-10-26-before-release
```

PowerShell 中用 `$env:RECOVERY_DATABASE_URL` 设置环境变量，每条命令写为一行即可。不要用 PowerShell `>` 重定向二进制 dump，工具已经通过二进制流写入文件。如果宿主机没有 PostgreSQL 客户端，可设置 `RECOVERY_PG_CONTAINER` 为已有数据库工具容器名；此时 URL 中的主机和端口必须在该容器内可达，例如 PostgreSQL 自己的容器内为 `127.0.0.1:5432`。密码通过环境传递，不出现在进程参数中。

失败会返回非零退出码，可能留下不带完整清单的目录。修复原因后选择**新目录**重试。备份体积取决于附件数量；本工具的数据库元数据查询上限为 64 MiB，超限会失败而不会标记成功。大规模部署应另行采用快照或持续归档方案。

## Docker Compose 备份

仓库新增仅按需运行的 `ops` 服务，使用项目自身的 `uploads` 卷，避免硬编码卷名前缀。普通 `docker compose up` 不启动它。[Compose profiles 文档](https://docs.docker.com/compose/how-tos/profiles/)

```bash
# 提前构建工具镜像；BACKUP_DIR 指向宿主机受限备份目录。
docker compose build ops
# 停止 app 的所有副本；数据库和 Redis 保持运行。
docker compose stop app
# RECOVERY_DATABASE_URL 使用容器网络 postgres:5432，并指明真实数据库账号。
docker compose run --rm --no-deps ops backup --uploads /source-uploads \
  --output /backups/2026-10-26-before-release --release <image-id> --quiesced
docker compose run --rm --no-deps ops verify --backup /backups/2026-10-26-before-release
# 两条命令均成功，且此时不准备升级时再启动原服务。
docker compose start app
```

`BACKUP_DIR` 默认 `./backups`，已从 Git 和 Docker 构建上下文排除。不要把备份目录放在 uploads 内，也不要把唯一备份只保存在应用机器上。建议先确定允许的数据损失窗口：若每日停机备份一次，最坏可能丢失一天数据；需要更短窗口时再安排更频繁备份或 WAL 持续归档。保留策略由实际容量决定，工具不会自动删除备份。

## 恢复到新环境

1. 验证备份副本；准备与备份匹配的应用版本、单独保存的配置、兼容的 PostgreSQL 及一个**新建空数据库**。连接账号需具备建表权限；恢复时对象归该账号所有，原角色和权限不会复制。
2. 新数据库名称必须与来源库不同；附件目标目录必须尚不存在，父目录必须已存在。工具没有覆盖模式，不提供 `--clean` 或原地回退。
3. 在运行任何恢复后的应用之前隔离外发网络，包括 SMTP、Webhook、AI 和微信；生产备份中的数据库设置可能覆盖空环境变量。恢复演练不要连接生产 Redis。备份中的待处理任务可能在启动后执行；故障期间已经投递的外部通知也可能在回退后再次投递，数据库去重不能消除跨备份时间点的外部副作用。

```bash
# RECOVERY_DATABASE_URL 已切换到新建的 beesupport_restore_20261026。
# 默认只校验并输出恢复计划，无数据库或附件写入。
pnpm ops:restore --backup /srv/beesupport-backups/2026-10-26-before-release \
  --uploads /srv/beesupport/data/uploads-restored-20261026
# 确认目标无其他写入进程后执行同一计划。
pnpm ops:restore --backup /srv/beesupport-backups/2026-10-26-before-release \
  --uploads /srv/beesupport/data/uploads-restored-20261026 --apply --quiesced
```

恢复先校验整个备份，再复制附件，然后使用 `pg_restore --single-transaction --exit-on-error` 导入。导入失败时数据库事务回滚；复制出来的新附件目录保留供排查，不会自动删除。成功后核对全部表行数、迁移记录和附件字节哈希，输出 `restored-and-verified` 及 `durationMs`。[PostgreSQL pg_restore 文档](https://www.postgresql.org/docs/17/app-pgrestore.html)

Compose 可通过单次额外挂载恢复到宿主机的新目录：

```bash
docker compose run --rm --no-deps -v /srv/beesupport-recovered:/restore ops \
  restore --backup /backups/2026-10-26-before-release \
  --uploads /restore/uploads-20261026 --apply --quiesced
```

之后先在隔离环境将应用的 `DATABASE_URL` 和 `UPLOAD_DIR` 指向新库、新目录，用原版本启动并检查登录、历史消息、附件下载和实时收发。不要先在恢复库上运行新版本的自动迁移。Compose 的 app 默认启动命令包含迁移，因此必须选对镜像；覆盖 uploads 挂载时用目标 `/app/data/uploads` 的 bind mount，同时覆盖 app 的 `DATABASE_URL`。宿主机 systemd 则更新对应版本目录中的受限 `.env`，然后重新生成/核对服务单元。

## 发布及回退顺序

1. 在独立源码目录构建候选版本，运行 `pnpm check`、数据库回归和相关端到端验收。不要覆盖正在运行实例的 `.next`。保存候选 Git revision、镜像 ID、依赖锁文件及本次迁移清单；有未提交代码时先形成可追溯的发布提交/制品。
2. 当前 Compose app 支持 `APP_IMAGE`，默认 `beesupport:local`。发布使用唯一版本标签，记录旧镜像 ID；提前构建候选镜像和 ops 镜像。不要把同一个 `local/latest` 标签当作回退依据，也不要提前清理旧镜像。
3. 关闭入口，停止全部应用/worker，创建并验证数据库+附件配套备份。对准备发布的备份做一次新库恢复演练，记录备份和恢复耗时；演练时长还需计入环境准备、应用启动、人工核验及流量切换时间，不能把 `durationMs` 当完整 RTO。
4. 核对备份成功后应用增量迁移并启动候选版本：Compose 设置 `APP_IMAGE` 后 `docker compose up -d --no-deps --no-build app`；其启动命令自动执行 `prisma migrate deploy`。宿主机版本先 `pnpm db:deploy`，再切换服务到已构建目录。迁移失败时保持入口关闭，不手工修改 `_prisma_migrations` 来绕过失败。
5. 使用对应发布源码，在服务启动后运行以下检查。它只读业务数据库，检查存活、依赖就绪、首页、嵌入脚本、后台鉴权、Socket.IO 握手，以及发布与数据库迁移名称/校验和完全一致。

```bash
# RECOVERY_DATABASE_URL 指向待发布实例的数据库。
pnpm ops:release-check --url https://support.example.com --admin-path /实际后台入口
```

6. 在入口仍受控时验证管理员/商家登录、历史消息和附件、访客与客服双向通信、AI 开关和后台任务状态，确认无持续错误，再开放流量。记录发布版本、备份目录、检查结果及责任人。上述命令不能替代这些业务检查。

回退按故障时点处理：

- **数据库尚未迁移、业务未开放**：保持原数据，使用记录的旧镜像 ID/旧版本目录重新启动，核验后开放入口。
- **数据库已经迁移**：优先修复后继续发布。不能假定旧代码兼容新结构，也不要执行反向 SQL 删表。确需切回旧代码时，先在隔离副本验证兼容性；本项目迁移核验要求版本与库完全匹配，会拒绝未经确认的差异。
- **必须恢复整套数据**：停止写入，先额外保存故障现场；按上节恢复到新库、新附件目录，并使用备份时的版本。核对备份时间之后的新增数据、订单和通知影响，再决定流量切换。原库与原附件保持不动，切换失败可以返回原目标。该路径会回到备份时间点，不是无损回滚。

不要使用 `docker compose down -v` 清理发布环境，也不要自动清空 uploads 或数据库。配置/密钥回退应与版本同步，`AUTH_SECRET` 意外改变会使登录会话失效。

## 可重复的隔离演练

```bash
# TEST_DATABASE_URL 必须为获准的独立测试 PostgreSQL，连接角色需能建库。
# 本机无 pg 客户端时可用 RECOVERY_PG_CONTAINER 指向该测试数据库容器。
# 可选 RECOVERY_DRILL_BUILD=.next 指向已验证生产构建，增加恢复后应用验收。
# 可选 RECOVERY_DRILL_OPS_IMAGE=beesupport-ops:ci 同时验证已构建的运维镜像（需测试容器）。
pnpm test:recovery
```

脚本在所选测试集群中新建两个唯一命名数据库；验证运维镜像时再建第三个。迁移并放入自己的演示数据、中文消息、二进制附件与旧 Windows 文件键。验证活动连接拒绝、默认只读计划、损坏拒绝、非空库保护、重复恢复拒绝、数据/文件一致性；指定构建目录后启动恢复实例，运行发布检查、历史消息/附件实际读取及 65 项核心端到端检查。结束后删除自己的临时数据库/文件并停止实例，保留 `test-results/recovery/` 的日志、耗时和结果。它不恢复真实业务数据，也不会访问生产模型或发送真实邮件。CI 已包含这一流程。
