"use client";

import { WechatLoginPanelView } from "./wechat-login-panel-view";
import { useWechatLogin } from "./use-wechat-login";
import type {
  WechatConfigView,
  WechatStateView,
} from "./wechat-login-types";

export type {
  WechatConfigView,
  WechatLog,
  WechatStateView,
  WechatStatus,
} from "./wechat-login-types";

export function WechatLoginPanel({
  initialState,
  initialConfig,
}: {
  initialState: WechatStateView;
  initialConfig: WechatConfigView;
}) {
  const controller = useWechatLogin({ initialState, initialConfig });
  return <WechatLoginPanelView controller={controller} />;
}
