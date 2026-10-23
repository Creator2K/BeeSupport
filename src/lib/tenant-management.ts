import { z } from "zod";
import { emailSchema, siteSlugSchema } from "./validation";
import { featuresSchema, LEGACY_FEATURES } from "./entitlements";
export const tenantManagementSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: siteSlugSchema,
  status: z.enum(["PENDING", "ACTIVE", "SUSPENDED"]),
  planName: z.string().trim().min(1).max(60),
  expiresAt: z.string().datetime().nullable(),
  maxAgents: z.number().int().min(1).max(100000),
  maxSites: z.number().int().min(1).max(100000),
  monthlyConversations: z.number().int().min(1).max(100000000),
  storageMB: z.number().int().min(1).max(100000000),
  contactEmail: z.union([emailSchema, z.literal("")]),
  note: z.string().trim().max(1000),
  features: featuresSchema.default(LEGACY_FEATURES),
});
export type TenantInput = z.input<typeof tenantManagementSchema>;
