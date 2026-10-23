export type ShellUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantExpired?: boolean;
  tenantName?: string;
  counts?: {
    merchants?: number;
    orders?: number;
    conversations?: number;
    notices?: number;
  };
};
