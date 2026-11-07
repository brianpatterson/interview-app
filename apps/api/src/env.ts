import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.string().optional(),
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
    /** Resend API key (sending access only). Blank in development: emails go to the log. */
    RESEND_API_KEY: z.string().optional(),
    /** Sender, e.g. `Interview App <no-reply@mail.example.com>`, on a domain verified in Resend. */
    EMAIL_FROM: z.string().optional(),
  })
  // Sign-up requires clicking an emailed link, so production without a real mailer would lock
  // every new user out. Fail at startup instead: the deploy's health check fails and rolls back.
  .refine((env) => env.NODE_ENV !== 'production' || (env.RESEND_API_KEY && env.EMAIL_FROM), {
    message: 'RESEND_API_KEY and EMAIL_FROM are required in production',
    path: ['RESEND_API_KEY'],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Compose passes unset optional variables as empty strings. Treat those as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
