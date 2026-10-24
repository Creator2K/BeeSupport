export type AccountAccessMode = "forgot" | "reset" | "verify" | "invite";

export type AccountAccessDetails = {
  email: string;
  team: string;
  role: string;
};
