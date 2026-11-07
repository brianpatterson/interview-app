import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './env.js';

/** Limits are counted per kind, so verification retries never block a password reset. */
export type EmailKind = 'password-reset' | 'verification';

export interface Email {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
}

export type SendEmail = (email: Email) => Promise<void>;

/**
 * Development mailer: logs the email instead of sending it, so links (password resets, email
 * verification) can be copied from the API's log.
 */
export function logMailer(log: Pick<FastifyBaseLogger, 'info'>): SendEmail {
  return async (email) => {
    log.info({ email }, `Email to ${email.to}: ${email.subject}`);
  };
}

/**
 * Sends through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * One POST with `fetch` instead of the `resend` SDK: no dependency for a single endpoint.
 * Throws on failure so the caller (Better Auth) returns an error instead of pretending it sent.
 */
export function resendMailer(
  apiKey: string,
  from: string,
  fetchImpl: typeof fetch = fetch,
): SendEmail {
  return async ({ to, subject, text }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Resend's error body names the problem (e.g. an unverified domain) and contains no secrets.
      const detail = (await res.text()).slice(0, 500);
      throw new Error(`Resend rejected the email (HTTP ${res.status}): ${detail}`);
    }
  };
}

/** Resend when it's configured (always in production; see env.ts), otherwise the log. */
export function mailerFromEnv(env: Env, log: Pick<FastifyBaseLogger, 'info'>): SendEmail {
  return env.RESEND_API_KEY && env.EMAIL_FROM
    ? resendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
    : logMailer(log);
}
