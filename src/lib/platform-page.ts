import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "./auth";

export async function requirePlatformPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") notFound();
  return user;
}
