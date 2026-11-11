"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, MessageCircleMore, X } from "lucide-react";
import { LauncherPreview } from "@/components/widget/launcher-preview";
import { launcherStyleOptions, type LauncherStyle } from "@/lib/launcher";
import styles from "./home.module.css";

const colors = [
  { name: "经典黑", value: "#18181b" },
  { name: "暖阳黄", value: "#eab308" },
  { name: "森林绿", value: "#135b46" },
  { name: "晴空蓝", value: "#2563eb" },
];
const prompts = [
  {
    question: "可以接入多个网站吗？",
    answer:
      "可以。一个工作台统一接待多个站点，每个站点都能单独设置外观、欢迎语和客服团队。",
  },
  {
    question: "能限制访客连续发图吗？",
    answer:
      "可以开启图片逐张放行。客服允许后，访客才能继续发下一张，文字沟通不受影响。",
  },
];
type Message = { from: "visitor" | "agent"; text: string };

export function AppearanceDemo() {
  const [kind, setKind] = useState<LauncherStyle>("pill");
  const [color, setColor] = useState(colors[0].value);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messageList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages, open]);
  const [selected, setSelected] = useState<number[]>([]);
  const choosePrompt = (index: number) => {
    if (selected.includes(index)) return;
    setSelected((previous) => [...previous, index]);
    setMessages((previous) => [
      ...previous,
      { from: "visitor", text: prompts[index].question },
      { from: "agent", text: prompts[index].answer },
    ]);
  };
  return (
    <div className={styles.appearanceGrid}>
      <div>
        <p className={styles.eyebrow}>MAKE IT YOURS</p>
        <h2 className={styles.sectionTitle}>
          是客服入口，
          <br />
          也是你的品牌。
        </h2>
        <p className={styles.sectionText}>
          选择一种喜欢的样式，再换个颜色。小小的悬浮按钮，也能自然融入你的网站。
        </p>
        <div
          role="group"
          aria-label="体验悬浮按钮样式"
          className={styles.styleOptions}
        >
          {launcherStyleOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
            >
              <span>{option.label}</span>
              {kind === option.value && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label="体验品牌颜色"
          className={styles.colorOptions}
        >
          {colors.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-label={option.name}
              aria-pressed={color === option.value}
              onClick={() => setColor(option.value)}
              style={{ backgroundColor: option.value }}
            >
              <span className="sr-only">{option.name}</span>
              {color === option.value && (
                <Check
                  size={16}
                  color={option.value === "#eab308" ? "#000" : "#fff"}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
          <span>随心选色，适配品牌</span>
        </div>
      </div>
      <div className={styles.demoBrowser} data-testid="appearance-demo">
        <div className={styles.browserBar}>
          <span className={styles.browserDots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>your-website.com</span>
          <span className={styles.demoTag}>交互演示</span>
        </div>
        <div className={styles.demoWebsite}>
          <div className={styles.demoSiteNav}>
            <span>
              YOUR BRAND<span className={styles.tinyDot}>●</span>
            </span>
            <span>为好体验而生</span>
          </div>
          <div className={styles.demoSiteCopy}>
            <span>HELLO, THERE.</span>
            <h3>
              你的好产品，
              <br />
              值得被好好了解。
            </h3>
            <p>把沟通的距离，缩短到一次点击。</p>
            <span className={styles.fakeSiteButton}>
              发现更多 <span aria-hidden="true">↗</span>
            </span>
          </div>
          <div className={styles.demoArtwork} aria-hidden="true">
            <div />
            <div />
            <div />
          </div>
          {open && (
            <section
              id="home-demo-chat"
              role="region"
              aria-label="客服窗口交互演示"
              className={styles.demoChat}
            >
              <div className={styles.demoChatHeader}>
                <span className={styles.chatAvatar}>
                  <MessageCircleMore size={19} />
                </span>
                <div>
                  <strong>你好，有什么可以帮你？</strong>
                  <span>本地演示 · 无需提交资料</span>
                </div>
                <button
                  type="button"
                  aria-label="关闭演示窗口"
                  onClick={() => setOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <div
                className={styles.demoMessages}
                ref={messageList}
                role="log"
                aria-label="演示聊天记录"
                tabIndex={0}
                aria-live="polite"
                aria-relevant="additions"
              >
                <p className={styles.agentMessage}>
                  欢迎体验 BeeSupport！点击下方问题，看看聊天窗口的交互效果。
                </p>
                {messages.map((message, index) => (
                  <p
                    key={index}
                    className={
                      message.from === "visitor"
                        ? styles.visitorMessage
                        : styles.agentMessage
                    }
                  >
                    {message.text}
                  </p>
                ))}
              </div>
              <div className={styles.demoPrompts}>
                {prompts.map((prompt, index) => (
                  <button
                    type="button"
                    key={prompt.question}
                    disabled={selected.includes(index)}
                    onClick={() => choosePrompt(index)}
                  >
                    {prompt.question}
                  </button>
                ))}
              </div>
              <div className={styles.demoChatFoot}>
                <span>选择一个问题，体验对话</span>
                <ArrowUp size={16} aria-hidden="true" />
              </div>
            </section>
          )}
          <button
            type="button"
            className={styles.demoLauncher}
            aria-label={open ? "收起演示客服" : "打开演示客服"}
            aria-expanded={open}
            aria-controls="home-demo-chat"
            onClick={() => setOpen((previous) => !previous)}
          >
            <LauncherPreview
              style={kind}
              color={color}
              label="聊一聊"
              open={open}
            />
          </button>
        </div>
        <p className={styles.demoCaption}>
          点击悬浮按钮体验开关；此处演示不会创建真实会话。
        </p>
      </div>
    </div>
  );
}
