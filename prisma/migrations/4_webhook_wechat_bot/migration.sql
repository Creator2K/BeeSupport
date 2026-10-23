-- 微信个人号通知：进程内扫码登录（@wechatbot/wechatbot），
-- 不再依赖外部桥接服务；WECHAT 保留给自建桥接。
ALTER TYPE "WebhookType" ADD VALUE IF NOT EXISTS 'WECHAT_BOT';
