/** Never inherit the application's database when running write-based tests. */
export function useTestDatabase() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      "请提供独立测试数据库 TEST_DATABASE_URL；测试不会使用应用的 DATABASE_URL。",
    );
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("TEST_DATABASE_URL 必须是 PostgreSQL 连接地址");
  process.env.DATABASE_URL = value;
}

export async function restoreSetting(prisma, key, saved) {
  if (saved) {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: saved.value },
      update: { value: saved.value },
    });
  } else {
    await prisma.setting.deleteMany({ where: { key } });
  }
}
