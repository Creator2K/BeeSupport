import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import type { HomeContent } from "@/lib/homepage-content";

import styles from "./home.module.css";

export function HomeHeader({ content }: { content: HomeContent }) {
  return (
    <header className={styles.header}>
      <div className={styles.navInner}>
        <Link
          href="/"
          aria-label={`${content.brandName} 首页`}
          className={styles.brand}
        >
          <BrandMark />
          <span className={styles.brandText}>{content.brandName}</span>
        </Link>
        <nav aria-label="首页导航" className={styles.navLinks}>
          {content.sections.features && <a href="#features">产品能力</a>}
          {content.sections.appearance && <a href="#appearance">外观体验</a>}
          {content.sections.steps && <a href="#start">如何接入</a>}
          {content.sections.faq && <a href="#faq">常见问题</a>}
        </nav>
        <div className={styles.navActions}>
          <Link href="/login">
            登录<span className={styles.desktopOnly}>控制台</span>
          </Link>
          <Link href="/register" className={styles.smallButton}>
            申请入驻 <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
