import styles from "./home.module.css";

export function HomeSteps({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <section id="start" className={`${styles.container} ${styles.section}`}>
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
  );
}
