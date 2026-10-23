import { z } from "zod";
import { DEFAULT_HOME_CONTENT, type HomeContent } from "./homepage-content";
const text = (max: number) =>
  z.string().trim().min(1, "请填写内容").max(max, `内容不能超过 ${max} 字`);
export const homeContentSchema = z
  .object({
    brandName: text(40),
    description: text(300),
    heroEyebrow: text(80),
    titleLine1: text(40),
    titleLine2: z.string().trim().max(40),
    titleHighlight: text(40),
    heroDescription: text(400),
    primaryCta: text(30),
    closingTitle: text(100),
    footerText: text(150),
    sections: z
      .object({
        features: z.boolean(),
        appearance: z.boolean(),
        steps: z.boolean(),
        faq: z.boolean(),
        plans: z.boolean(),
      })
      .strict(),
    features: z
      .array(
        z.object({ title: text(60), text: text(400), tag: text(40) }).strict(),
      )
      .length(6),
    faqs: z
      .array(z.object({ question: text(120), answer: text(1000) }).strict())
      .min(1)
      .max(12),
    planIds: z
      .array(z.string().min(1).max(128))
      .max(6)
      .refine((ids) => new Set(ids).size === ids.length, "套餐不能重复"),
  })
  .strict();
export function readHomeDocument(value: unknown): {
  revision: string;
  content: HomeContent;
} {
  const document = z
    .object({ revision: z.string().min(1).max(80), content: homeContentSchema })
    .safeParse(value);
  return document.success
    ? document.data
    : { revision: "initial", content: DEFAULT_HOME_CONTENT };
}
