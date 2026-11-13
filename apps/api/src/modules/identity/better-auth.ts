import { Redacted } from 'effect';
import type { AuthProvider } from '@roundtable/contract';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import type { Db } from '../../platform/database/promise.js';
import { accounts, sessions, users, verifications } from './schema.js';
import type { SendEmail } from '../email/index.js';
import type { Env } from '../../platform/config/env.js';
import { betterAuthLogger } from '../../platform/observability/logging.js';

export type { AuthProvider };

export function enabledProviders(env: Env): AuthProvider[] {
  const providers: AuthProvider[] = [];

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) providers.push('github');

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) providers.push('google');

  return providers;
}

/** Only the providers whose credentials are configured (same rule as enabledProviders). */
function socialProviders(env: Env): NonNullable<BetterAuthOptions['socialProviders']> {
  const providers: NonNullable<BetterAuthOptions['socialProviders']> = {};

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.github = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: Redacted.value(env.GITHUB_CLIENT_SECRET),
    };
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: Redacted.value(env.GOOGLE_CLIENT_SECRET),
    };
  }

  return providers;
}

export function createAuth(
  db: Db,
  env: Env,
  sendEmail: SendEmail,
  log: Parameters<typeof betterAuthLogger>[0],
  onUnexpectedError: (error: Error) => void = () => {},
) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: Redacted.value(env.BETTER_AUTH_SECRET),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: users, session: sessions, account: accounts, verification: verifications },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // No session until the user clicks the emailed link: proves they own the address, which
      // account linking (below) relies on, and stops sign-ups with someone else's email.
      requireEmailVerification: true,
      // A reset means the password may have leaked: sign out every other device.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail({
          kind: 'password-reset',
          to: user.email,
          subject: 'Reset your Roundtable password',
          text: `Reset your password: ${url}\n\nIf you didn't ask for this, ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // An unverified user who tries to sign in (or lost the first email) gets a fresh link.
      sendOnSignIn: true,
      // Clicking the link signs them in, instead of making them type the password again.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail({
          kind: 'verification',
          to: user.email,
          subject: 'Confirm your email for Roundtable',
          text: `Confirm your email to finish signing up: ${url}\n\nThe link expires in 1 hour. If you didn't sign up, ignore this email.`,
        });
      },
    },
    socialProviders: socialProviders(env),
    // Let a user who signed up with email later sign in with GitHub/Google using the same email,
    // instead of creating a second account. Only when BOTH sides have verified it: the provider
    // (Better Auth's default without `trustedProviders`) and our account
    // (`requireLocalEmailVerified`, on by default). Listing providers as trusted skips the
    // provider check: a GitHub account showing someone's address without having verified it would
    // be signed into their account (oauth.test.ts).
    account: { accountLinking: { enabled: true, requireLocalEmailVerified: true } },
    // Better Auth silently disables its CSRF origin check when NODE_ENV=test. Force it on so the
    // test suite exercises the same protection as production.
    advanced: { disableOriginCheck: false },
    // Per client IP, in memory, production only (Better Auth's defaults are per minute, which
    // still allows thousands of emails a day from one machine). the email module adds per-address
    // and daily caps that survive restarts. ADR-0018.
    rateLimit: {
      customRules: {
        '/request-password-reset': { window: 3600, max: 5 },
        '/send-verification-email': { window: 3600, max: 5 },
        '/sign-up/email': { window: 3600, max: 10 },
      },
    },
    // Better Auth catches errors from its endpoints (and from our email callbacks) and answers
    // with an error response, so they never reach Fastify's error handler. Report the unexpected
    // ones; 4xx (wrong password, expired token) are normal traffic. Replaces Better Auth's own
    // error logging, so the callback logs too.
    onAPIError: {
      onError: (error) => {
        if (error instanceof APIError && error.statusCode < 500) return;
        onUnexpectedError(
          error instanceof Error ? error : new Error('Non-Error thrown in auth', { cause: error }),
        );
      },
    },
    // Through our logger (and its redaction), not straight to the console.
    logger: betterAuthLogger(log),
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
