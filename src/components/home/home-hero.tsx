import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";

import type { HomeContent } from "@/lib/homepage-content";

import { ProductScene } from "./product-scene";
import styles from "./home.module.css";

export function HomeHero({
  content,
  secondaryAnchor,
}: {
  content: HomeContent;
  secondaryAnchor: string;
}) {
  return (
    <>
      <section className={`${styles.container} ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className={styles.heroEyebrow}>
            <span /> {content.heroEyebrow}
          </p>
          <h1>
            {content.titleLine1}
            <br />
            {content.titleLine2}
            <span className={styles.heroUnderline}>
              {content.titleHighlight}
            </span>
          </h1>
          <p className={styles.heroText}>{content.heroDescription}</p>
          <div className={styles.heroActions}>
            <Link href="/register" className={styles.primaryButton}>
              {content.primaryCta}{" "}
              <ArrowUpRight size={19} aria-hidden="true" />
            </Link>
            <a href={secondaryAnchor} className={styles.textButton}>
              先看看效果 <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>
          <div className={styles.heroChecks}>
            {["独立商家空间", "品牌自由配置", "电脑手机适配"].map((text) => (
              <span key={text}>
                <Check size={14} aria-hidden="true" />
                {text}
              </span>
            ))}
          </div>
        </div>
        <ProductScene brandName={content.brandName} />
      </section>
      <div className={`${styles.container} ${styles.statement}`}>
        <span>ONE WORKSPACE. EVERY CONVERSATION.</span>
        <p>
          站点可以很多，<strong>服务不必分散。</strong>
        </p>
        <span className={styles.statementLine} />
      </div>
    </>
  );
}
