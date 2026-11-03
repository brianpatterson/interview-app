import type { FastifyBaseLogger } from 'fastify';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

export type SendEmail = (email: Email) => Promise<void>;

/**
 * Development mailer: logs the email instead of sending it, so links (like password resets)
 * can be copied from the API's log. Production will swap in a real provider.
 */
export function logMailer(log: Pick<FastifyBaseLogger, 'info'>): SendEmail {
  return async (email) => {
    log.info({ email }, `Email to ${email.to}: ${email.subject}`);
  };
}
