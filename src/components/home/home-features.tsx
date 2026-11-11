import {
  ChartNoAxesCombined,
  Globe2,
  Layers3,
  Palette,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import type { HomeContent } from "@/lib/homepage-content";

import styles from "./home.module.css";

const icons = [
  Globe2,
  Palette,
  UsersRound,
  ChartNoAxesCombined,
  ShieldCheck,
  Layers3,
];

export function HomeFeatures({ content }: { content: HomeContent }) {
  if (!content.sections.features) return null;
  const features = content.features.map((feature, index) => ({
    ...feature,
    icon: icons[index],
  }));

  return (
    <section id="features" className={`${styles.container} ${styles.section}`}>
      <div className={styles.sectionHeading}>
        <div data-reveal="blur">
          <p className={styles.eyebrow}>BUILT FOR YOUR TEAM</p>
          <h2 className={styles.sectionTitle}>
            从一次对话，
            <br />
            到一整套服务。
          </h2>
        </div>
        <p className={styles.sectionText} data-reveal>
          让访客更容易找到你，让客服更从容地回应。
          <br />
          日常接待与商家运营，都有清楚的位置。
        </p>
      </div>
      <div className={styles.featureGrid}>
        {features.map((feature, index) => (
          <article
            key={index}
            className={styles.featureCard}
            data-reveal
            data-spotlight
          >
            <span className={styles.featureIcon}>
              <feature.icon size={23} strokeWidth={1.6} aria-hidden="true" />
            </span>
            <span className={styles.featureTag}>{feature.tag}</span>
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
