/** .env.example 和旧版 docker-compose.yml 里公开的数据库密码。 */
const PUBLIC_DATABASE_PASSWORDS = new Set(["beesupport"]);

export type DeploymentWarning = { event: string; hint: string };

function databasePassword(url: string | undefined): string {
  try {
    return decodeURIComponent(new URL(url ?? "").password);
  } catch {
    return "";
  }
}

/** 生产环境里不阻止启动、但运维应当知道的配置问题。 */
export function deploymentWarnings(config: {
  production: boolean;
  appUrl: string | undefined;
  databaseUrl: string | undefined;
}): DeploymentWarning[] {
  if (!config.production) return [];
  const warnings: DeploymentWarning[] = [];
  if (!(config.appUrl ?? "").startsWith("https://"))
    warnings.push({
      event: "config.app_url_not_https",
      hint: "APP_URL 不是 https 地址：登录 Cookie 只在请求经 HTTPS 到达时才带 Secure，邮件和通知里的链接也是 http。站点通过 HTTPS 访问时请改成 https 地址",
    });
  if (PUBLIC_DATABASE_PASSWORDS.has(databasePassword(config.databaseUrl)))
    warnings.push({
      event: "config.public_database_password",
      hint: "数据库使用的是仓库公开的示例密码，请更换",
    });
  return warnings;
}
