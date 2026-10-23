import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = dotenv.parse(readFileSync(join(root, ".env")));
const dist = config.NEXT_DIST_DIR || ".next";
const quote = (value) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;
const unit = `[Unit]
Description=BeeSupport application and notification worker
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
WorkingDirectory=${root.replaceAll("%", "%%")}
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStartPre=${quote(process.execPath)} ${quote(join(root, "node_modules/prisma/build/index.js"))} migrate deploy
ExecStart=${quote(process.execPath)} --import tsx server.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=40
KillMode=mixed
UMask=0027
NoNewPrivileges=true
StandardOutput=journal
StandardError=journal
SyslogIdentifier=beesupport

[Install]
WantedBy=default.target
`;

if (!process.argv.includes("--install")) {
  process.stdout.write(unit);
} else {
  if (!existsSync(join(root, dist, "BUILD_ID")))
    throw new Error("先运行 pnpm build，确认生产构建已完成。");
  execFileSync("systemctl", ["--user", "is-active", "default.target"], {
    stdio: "pipe",
  });
  const directory = join(homedir(), ".config/systemd/user");
  const path = join(directory, "beesupport.service");
  mkdirSync(directory, { recursive: true });
  if (existsSync(path)) writeFileSync(`${path}.previous`, readFileSync(path));
  writeFileSync(path, unit);
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  // Optional one-time handover from this project's detached development process.
  if (process.argv.includes("--replace-detached")) {
    const pidPath = join(root, "data/runtime/server.pid");
    if (existsSync(pidPath)) {
      const pid = Number(readFileSync(pidPath, "utf8").trim());
      if (Number.isInteger(pid) && pid > 1 && existsSync(`/proc/${pid}`)) {
        const cwd = realpathSync(`/proc/${pid}/cwd`);
        const args = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
        if (cwd !== root || !args.includes("server.ts"))
          throw new Error("PID 不属于本项目，已停止交接。");
        process.kill(pid, "SIGTERM");
        for (
          let index = 0;
          index < 200 && existsSync(`/proc/${pid}`);
          index += 1
        )
          await delay(200);
        if (
          existsSync(`/proc/${pid}`) &&
          !readFileSync(`/proc/${pid}/stat`, "utf8").includes(") Z ")
        )
          throw new Error("旧服务未退出，请检查后重试。");
      }
    }
  }
  execFileSync("systemctl", ["--user", "enable", "beesupport.service"], {
    stdio: "inherit",
  });
  execFileSync("systemctl", ["--user", "restart", "beesupport.service"], {
    stdio: "inherit",
  });
  const pid = Number(
    execFileSync(
      "systemctl",
      ["--user", "show", "beesupport.service", "--property=MainPID", "--value"],
      { encoding: "utf8" },
    ).trim(),
  );
  const runtime = join(root, "data/runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "server.pid"), `${pid}\n`);
  writeFileSync(
    join(runtime, "server.json"),
    JSON.stringify(
      {
        pid,
        manager: "systemd",
        unit: "beesupport.service",
        url: config.APP_URL,
        log: "journalctl --user -u beesupport",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `服务已安装：${path}\n状态：systemctl --user status beesupport\n日志：journalctl --user -u beesupport -n 100`,
  );
}
