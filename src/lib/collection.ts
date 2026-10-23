import { z } from "zod";

export const COLLECTION_KEY = "subscriptions.collection";
export const DEFAULT_COLLECTION = {
  enabled: false,
  title: "人工收款说明",
  instructions: "",
  contact: "",
  qrCodeUrl: "",
};
export const collectionSchema = z
  .object({
    enabled: z.boolean(),
    title: z.string().trim().min(1).max(60),
    instructions: z.string().trim().max(2000),
    contact: z.string().trim().max(200),
    qrCodeUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "收款码请使用 http 或 https 图片地址"),
  })
  .strict()
  .refine(
    (value) => !value.enabled || Boolean(value.instructions || value.contact),
    {
      message: "启用前请填写收款说明或联系方式",
    },
  );
export type CollectionSettings = z.infer<typeof collectionSchema>;
export function readCollection(value: unknown) {
  const parsed = z
    .object({ revision: z.string(), settings: collectionSchema })
    .safeParse(value);
  return parsed.success
    ? parsed.data
    : { revision: "initial", settings: DEFAULT_COLLECTION };
}
export const paymentReportSchema = z
  .object({
    note: z
      .string()
      .trim()
      .min(1, "请填写付款渠道、付款人或交易信息，方便平台核对")
      .max(500),
    expectedVersion: z.number().int().min(0).max(2147483646),
    acknowledged: z.literal(true, { error: "请确认已完成付款" }),
  })
  .strict();
