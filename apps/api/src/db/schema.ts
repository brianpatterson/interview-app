import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { APPLICATION_STATUSES } from '@interview-app/shared';

export const applicationStatus = pgEnum('application_status', APPLICATION_STATUSES);

export const applications = pgTable(
  'applications',
  {
    id: uuid().primaryKey().defaultRandom(),
    company: text().notNull(),
    jobTitle: text('job_title').notNull(),
    jobUrl: text('job_url'),
    status: applicationStatus().notNull().default('applied'),
    // The creation date doubles as the date the application was submitted.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('applications_updated_at_idx').on(t.updatedAt)],
);
