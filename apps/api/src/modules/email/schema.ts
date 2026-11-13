import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per auth email handed to the provider, for the sending limits in mailer.ts
 * (ADR-0018). Kept for 7 days, then deleted.
 */
export const emailSends = pgTable(
  'email_sends',
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient: text().notNull(),
    kind: text().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_sends_recipient_kind_sent_at_idx').on(t.recipient, t.kind, t.sentAt),
    index('email_sends_sent_at_idx').on(t.sentAt),
  ],
);
