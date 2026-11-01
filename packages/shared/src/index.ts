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
export interface Application {
  id: string;
  company: string;
  jobTitle: string;
  jobUrl: string | null;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down';
  time: string;
}
