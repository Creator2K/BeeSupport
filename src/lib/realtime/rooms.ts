/** 房间命名集中管理，保证自定义 server 与业务代码使用同一套约定 */
export const rooms = {
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  agent: (userId: string) => `agent:${userId}`,
  siteAgents: (siteId: string) => `site:${siteId}:agents`,
  tenantAdmins: (tenantId: string) => `tenant:${tenantId}:admins`,
  tenantAgents: (tenantId: string) => `tenant:${tenantId}:agents`,
  allAgents: () => "agents",
  admins: () => "admins",
  visitor: (visitorId: string) => `visitor:${visitorId}`,
} as const;
