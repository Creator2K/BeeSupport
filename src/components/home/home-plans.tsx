import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import type { PublicHomePlan } from "@/lib/homepage-content";

import styles from "./home.module.css";

export function HomePlans({ plans }: { plans: PublicHomePlan[] }) {
  if (plans.length === 0) return null;
  return (
    <section id="plans" className={`${styles.container} ${styles.section}`}>
      <p className={styles.eyebrow}>PLANS FOR YOUR TEAM</p>
      <h2 className={styles.sectionTitle}>选择适合团队的服务。</h2>
      <p className={styles.sectionText}>
        按业务规模选择套餐，入驻审核后在后台提交订单，由平台核对收款并开通。
      </p>
      <div className={styles.planGrid}>
        {plans.map((plan) => (
          <article key={plan.id} className={styles.planCard}>
            <h3>{plan.name}</h3>
            <p>{plan.description}</p>
            <div className={styles.planPrice}>
              ¥{(plan.priceCents / 100).toFixed(2)}
              <span> / {plan.durationDays} 天</span>
            </div>
            <ul>
              <li>{plan.maxAgents} 个启用账号（含商家管理员）</li>
              <li>{plan.maxSites} 个站点</li>
              <li>
                每月 {plan.monthlyConversations.toLocaleString("zh-CN")} 段新会话
              </li>
              <li>{plan.storageMB.toLocaleString("zh-CN")} MB 存储</li>
            </ul>
            <Link href="/register" className={styles.primaryButton}>
              申请入驻 <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
