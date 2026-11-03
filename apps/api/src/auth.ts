import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from './db/index.js';
import { accounts, sessions, users, verifications } from './db/schema.js';
import type { SendEmail } from './email.js';
import type { Env } from './env.js';

export type AuthProvider = 'github' | 'google';

export function enabledProviders(env: Env): AuthProvider[] {
  const providers: AuthProvider[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push('github');
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');
  return providers;
}

export function createAuth(db: Db, env: Env, sendEmail: SendEmail) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          to: user.email,
          subject: 'Reset your Interview App password',
          text: `Reset your password: ${url}\n\nIf you didn't ask for this, ignore this email.`,
        });
      },
    },
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
        : {}),
    },
    // Let a user who signed up with email later sign in with GitHub/Google using the same
    // verified email, instead of creating a second account.
    account: { accountLinking: { enabled: true, trustedProviders: ['github', 'google'] } },
    // Better Auth silently disables its CSRF origin check when NODE_ENV=test. Force it on so the
    // test suite exercises the same protection as production.
    advanced: { disableOriginCheck: false },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
