export type HomeContent = {
  brandName: string;
  description: string;
  heroEyebrow: string;
  titleLine1: string;
  titleLine2: string;
  titleHighlight: string;
  heroDescription: string;
  primaryCta: string;
  closingTitle: string;
  footerText: string;
  sections: {
    features: boolean;
    appearance: boolean;
    steps: boolean;
    faq: boolean;
    plans: boolean;
  };
  features: { title: string; text: string; tag: string }[];
  faqs: { question: string; answer: string }[];
  planIds: string[];
};
export const DEFAULT_HOME_CONTENT: HomeContent = {
  brandName: "BeeSupport",
  description:
    "BeeSupport 统一托管客服平台：多站点接待、独立商家空间、品牌外观配置、访客画像与风控，让团队在一个工作台处理每一次咨询。",
  heroEyebrow: "为多站点业务而设计的客服平台",
  titleLine1: "把每一次咨询，",
  titleLine2: "接成",
  titleHighlight: "好体验。",
  heroDescription:
    "从网站上的一声「你好」，到团队里的每一次回应。\n用一个工作台，连接访客、客服和你的每个站点。",
  primaryCta: "开启你的客服空间",
  closingTitle: "下一次「你好」，\n从更好的服务开始。",
  footerText: "连接每个站点，认真回应每次咨询。",
  sections: {
    features: true,
    appearance: true,
    steps: true,
    faq: true,
    plans: true,
  },
  features: [
    {
      title: "多个站点，一处接待",
      text: "官网、商城、产品文档统一接入，按站点分配客服，在同一个工作台切换会话。",
      tag: "让沟通更集中",
    },
    {
      title: "保留自己的品牌感",
      text: "悬浮按钮、主题色、Logo 和欢迎语自由配置。商家统一设置，站点也能拥有自己的风格。",
      tag: "让入口更自然",
    },
    {
      title: "团队协作，有条不紊",
      text: "从待接入到转接、关闭，保留完整沟通记录。共享话术帮助客服更快回应常见问题。",
      tag: "让协作更顺畅",
    },
    {
      title: "看见访客，也看见趋势",
      text: "汇总设备、来源、回访和咨询情况，按站点查看访客画像，用整体数据了解服务对象。",
      tag: "让决策有依据",
    },
    {
      title: "让接待保持有序",
      text: "违禁词、IP 封禁、上传频率限制与图片逐张放行，为不同业务选择合适的防护方式。",
      tag: "让团队少些打扰",
    },
    {
      title: "商家独立，平台统一",
      text: "商家拥有独立的站点、团队与记录，平台集中管理入驻、套餐、额度和续费订单。",
      tag: "让运营更清晰",
    },
  ],
  faqs: [
    {
      question: "接入网站需要做什么？",
      answer:
        "申请入驻并开通后，在后台创建站点，将生成的嵌入代码加入网站。访客点击悬浮按钮即可咨询，电脑与手机会自动适配。",
    },
    {
      question: "每个站点可以使用不同外观吗？",
      answer:
        "可以。平台提供默认配置，商家可设定自己的品牌，站点还能分别覆盖主题色、按钮样式、文案和聊天功能；取消覆盖后恢复继承。",
    },
    {
      question: "访客需要注册账号吗？",
      answer:
        "不需要注册平台账号。你可以按站点设置是否要求访客填写邮箱，也可以允许访客直接发起咨询。",
    },
    {
      question: "套餐如何开通和续费？",
      answer:
        "入驻由平台审核开通。商家可在后台选择已上架套餐、提交续费订单，平台核对收款后确认生效，处理结果可在订单记录中查看。",
    },
  ],
  planIds: [],
};
export type PublicHomePlan = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  durationDays: number;
  maxAgents: number;
  maxSites: number;
  monthlyConversations: number;
  storageMB: number;
};
