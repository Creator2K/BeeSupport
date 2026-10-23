import Link from "next/link";
import { ArrowRight, ArrowUpRight, MessageCircleMore } from "lucide-react";

import { AppearanceDemo } from "@/components/home/appearance-demo";
import type { HomeContent, PublicHomePlan } from "@/lib/homepage-content";

import { HomeFaq } from "./home-faq";
import { HomeFeatures } from "./home-features";
import { HomeHeader } from "./home-header";
import { HomeHero } from "./home-hero";
import { HomePlans } from "./home-plans";
import { HomeSteps } from "./home-steps";
import styles from "./home.module.css";

export function HomeView({
  content,
  plans = [],
}: {
  content: HomeContent;
  plans?: PublicHomePlan[];
}) {
  const secondaryAnchor = content.sections.appearance
    ? "#appearance"
    : content.sections.features
      ? "#features"
      : content.sections.steps
        ? "#start"
        : content.sections.faq
          ? "#faq"
          : "#main-content";

  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skipLink}>
        跳到主要内容
      </a>
      <HomeHeader content={content} />
      <main id="main-content">
        <HomeHero content={content} secondaryAnchor={secondaryAnchor} />
        <HomeFeatures content={content} />
        {content.sections.appearance && (
          <section id="appearance" className={styles.appearanceSection}>
            <div className={styles.container}>
              <AppearanceDemo />
            </div>
          </section>
        )}
        <HomeSteps enabled={content.sections.steps} />
        {content.sections.faq && <HomeFaq faqs={content.faqs} />}
        <HomePlans plans={plans} />
        <section className={styles.closing}>
          <div className={styles.container}>
            <p className={styles.eyebrow}>LET’S TALK BETTER</p>
            <h2>{content.closingTitle}</h2>
            <Link href="/register" className={styles.limeButton}>
              申请入驻 {content.brandName}{" "}
              <ArrowUpRight size={20} aria-hidden="true" />
            </Link>
            <p>
              已有账号？
              <Link href="/login">
                登录控制台 <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </p>
          </div>
          <span className={styles.closingArt} aria-hidden="true">
            <MessageCircleMore />
          </span>
        </section>
      </main>
      <footer className={`${styles.container} ${styles.footer}`}>
        <div>
          <Link href="/" className={styles.footerBrand}>
            {content.brandName}
            <span>●</span>
          </Link>
          <p>{content.footerText}</p>
        </div>
        <nav aria-label="页脚导航">
          {content.sections.features && <a href="#features">产品能力</a>}
          <Link href="/register">申请入驻</Link>
          <Link href="/login">账号登录</Link>
          <a href="#main-content">回到顶部 ↑</a>
        </nav>
        <span>
          © {new Date().getFullYear()} {content.brandName}
        </span>
      </footer>
    </div>
  );
}
