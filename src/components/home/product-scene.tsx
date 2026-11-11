import {
  ArrowUpRight,
  Check,
  Circle,
  Globe2,
  Headset,
  ImageIcon,
  MoreHorizontal,
  Paperclip,
  Send,
  ShieldCheck,
  Smile,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";

import styles from "./home.module.css";

export function ProductScene({
  brandName = "BeeSupport",
}: {
  brandName?: string;
}) {
  return (
    <div className={styles.scene} aria-label="多站点客服工作台界面示意">
      <div className={styles.sceneTop}>
        <span className={styles.sceneLogo}>
          <BrandMark /> {brandName}
        </span>
        <span className={styles.sceneTag}>一个工作台，连接每个站点</span>
        <MoreHorizontal size={18} aria-hidden="true" />
      </div>
      <div className={styles.sceneBody}>
        <div className={styles.sceneSites}>
          <span className={styles.sceneSmall}>我的站点</span>
          <div className={styles.selectedSite}>
            <Globe2 size={16} />
            <span>品牌商城</span>
            <Circle size={6} fill="currentColor" />
          </div>
          <div>
            <Globe2 size={16} />
            <span>产品文档</span>
          </div>
          <div>
            <Globe2 size={16} />
            <span>移动站点</span>
          </div>
          <span className={styles.sceneSmall}>统一接待，独立配置</span>
          <div className={styles.sceneBottom}>
            <Headset size={17} />
            <span>客服工作台</span>
          </div>
        </div>
        <div className={styles.sceneChat}>
          <div className={styles.sceneChatTop}>
            <div className={styles.personAvatar}>林</div>
            <div>
              <strong>林同学</strong>
              <span>来自 品牌商城</span>
            </div>
            <span className={styles.inProgress}>进行中</span>
          </div>
          <div className={styles.sceneMessages}>
            <span className={styles.sceneTime}>对话界面示意</span>
            <p className={styles.sceneIncoming}>
              你好，想问下这个产品怎么使用？
            </p>
            <div className={styles.sceneReply}>
              <span>B</span>
              <p>
                你好！我来帮你一起看看。
                <br />
                可以发一张截图给我吗？
              </p>
            </div>
            <p className={styles.sceneIncoming}>
              <ImageIcon size={18} /> 图片支持直接放大查看
            </p>
            <span className={styles.sceneRead}>
              <Check size={12} /> 已送达
            </span>
          </div>
          <div className={styles.sceneComposer}>
            <span>输入消息…</span>
            <div>
              <Smile size={16} />
              <Paperclip size={16} />
              <span>
                <Send size={13} /> 发送
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className={styles.sceneFloat}>
        <span>
          <ShieldCheck size={20} />
        </span>
        <div>
          <strong>从沟通到管理，一处完成</strong>
          <p>会话 · 访客画像 · 风控 · 团队协作</p>
        </div>
        <ArrowUpRight size={17} />
      </div>
      <div className={styles.sceneNote}>
        <span /> 让服务衔接得更自然
      </div>
    </div>
  );
}
