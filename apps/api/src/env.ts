import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().default(3001),
  /** Signs session cookies and tokens. Generate with `openssl rand -base64 32`. */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public origin users see in the browser, e.g. http://localhost:5173 or https://example.com. */
  BETTER_AUTH_URL: z.url(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
