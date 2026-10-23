import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  Globe2,
  Layers3,
  MessageCircleMore,
  Palette,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { AppearanceDemo } from "@/components/home/appearance-demo";
import { ProductScene } from "@/components/home/product-scene";
import styles from "@/components/home/home.module.css";

import type { HomeContent, PublicHomePlan } from "@/lib/homepage-content";
const icons = [
  Globe2,
  Palette,
  UsersRound,
  ChartNoAxesCombined,
  ShieldCheck,
  Layers3,
];

export function HomeView({
  content,
  plans = [],
}: {
  content: HomeContent;
  plans?: PublicHomePlan[];
}) {
  const features = content.features.map((feature, index) => ({
    ...feature,
    icon: icons[index],
  }));
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
      <header className={styles.header}>
        <div className={styles.navInner}>
          <Link
            href="/"
            aria-label={`${content.brandName} 首页`}
            className={styles.brand}
          >
            <span>
              <MessageCircleMore size={21} />
            </span>
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
      <main id="main-content">
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
        {content.sections.features && (
          <section
            id="features"
            className={`${styles.container} ${styles.section}`}
          >
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>BUILT FOR YOUR TEAM</p>
                <h2 className={styles.sectionTitle}>
                  从一次对话，
                  <br />
                  到一整套服务。
                </h2>
              </div>
              <p className={styles.sectionText}>
                让访客更容易找到你，让客服更从容地回应。
                <br />
                日常接待与商家运营，都有清楚的位置。
              </p>
            </div>
            <div className={styles.featureGrid}>
              {features.map((feature, index) => (
                <article key={index} className={styles.featureCard}>
                  <span className={styles.featureIcon}>
                    <feature.icon
                      size={23}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                  </span>
                  <span className={styles.featureTag}>{feature.tag}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {content.sections.appearance && (
          <section id="appearance" className={styles.appearanceSection}>
            <div className={styles.container}>
              <AppearanceDemo />
            </div>
          </section>
        )}
        {content.sections.steps && (
          <section
            id="start"
            className={`${styles.container} ${styles.section}`}
          >
            <p className={styles.eyebrow}>A SIMPLE START</p>
            <div className={styles.sectionHeading}>
              <h2 className={styles.sectionTitle}>从这里，开始连接。</h2>
              <p className={styles.sectionText}>
                配置好你的空间，把精力留给服务。
              </p>
            </div>
            <div className={styles.steps}>
              {[
                [
                  "01",
                  "创建商家空间",
                  "提交入驻申请，审核开通后进入独立后台，选择适合业务的套餐与额度。",
                ],
                [
                  "02",
                  "让窗口融入品牌",
                  "创建站点，选择按钮样式与主题色，邀请客服并分配负责的站点。",
                ],
                [
                  "03",
                  "接入网站，开始对话",
                  "将嵌入代码加入网站。在工作台统一接待，持续查看会话和访客趋势。",
                ],
              ].map(([number, title, text]) => (
                <article key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {content.sections.faq && (
          <section
            id="faq"
            className={`${styles.container} ${styles.faqSection}`}
          >
            <div>
              <p className={styles.eyebrow}>GOOD TO KNOW</p>
              <h2 className={styles.sectionTitle}>你可能还想了解。</h2>
              <p className={styles.sectionText}>
                关于接入、外观与开通的几个常见问题。
              </p>
            </div>
            <div className={styles.faqList}>
              {content.faqs.map(({ question, answer }, index) => (
                <details key={index}>
                  <summary>
                    {question}
                    <span aria-hidden="true">＋</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}
        {plans.length > 0 && (
          <section
            id="plans"
            className={`${styles.container} ${styles.section}`}
          >
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
                      每月 {plan.monthlyConversations.toLocaleString("zh-CN")}{" "}
                      段新会话
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
        )}
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
