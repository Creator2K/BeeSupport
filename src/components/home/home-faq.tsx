import type { HomeContent } from "@/lib/homepage-content";

import styles from "./home.module.css";

export function HomeFaq({ faqs }: { faqs: HomeContent["faqs"] }) {
  return (
    <section id="faq" className={`${styles.container} ${styles.faqSection}`}>
      <div data-reveal="blur">
        <p className={styles.eyebrow}>GOOD TO KNOW</p>
        <h2 className={styles.sectionTitle}>你可能还想了解。</h2>
        <p className={styles.sectionText}>
          关于接入、外观与开通的几个常见问题。
        </p>
      </div>
      <div className={styles.faqList}>
        {faqs.map(({ question, answer }, index) => (
          <details key={index} data-reveal>
            <summary>
              {question}
              <span aria-hidden="true">＋</span>
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
