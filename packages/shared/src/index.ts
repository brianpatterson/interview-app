import { z } from 'zod';

export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interviewing',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

export const createApplicationSchema = z.object({
  company: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().min(1).max(200),
  jobUrl: z.url().max(2000).nullish(),
  status: applicationStatusSchema.optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = createApplicationSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type UpdateApplicationInput = z.infer<typeof updateApplicationSchema>;

/** An application as returned by the API (dates are ISO 8601 strings). */
export const applicationSchema = z.object({
  id: z.string(),
  company: z.string(),
  jobTitle: z.string(),
  jobUrl: z.string().nullable(),
  status: applicationStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Application = z.infer<typeof applicationSchema>;

export const authProviderSchema = z.enum(['github', 'google']);

export type AuthProvider = z.infer<typeof authProviderSchema>;

/** GET /api/auth-config: which social sign-in providers this deployment has configured. */
export const authConfigSchema = z.object({ providers: z.array(authProviderSchema) });

export type AuthConfig = z.infer<typeof authConfigSchema>;

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down';
  time: string;
}
