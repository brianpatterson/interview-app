import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { APPLICATION_STATUSES } from '@roundtable/contract';
import { timestamps } from '../../platform/database/columns.js';
import { users } from '../identity/index.js';

export const applicationStatus = pgEnum('application_status', APPLICATION_STATUSES);

// The foreign key to users is the one place this module reaches into identity's tables. It goes
// if applications ever gets its own database (ADR-0023).
export const applications = pgTable(
  'applications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    company: text().notNull(),
    jobTitle: text('job_title').notNull(),
    jobUrl: text('job_url'),
    status: applicationStatus().notNull().default('applied'),
    // The creation date doubles as the date the application was submitted.
    ...timestamps,
  },
  // Every query filters by user and sorts by most recently updated.
  (t) => [index('applications_user_id_updated_at_idx').on(t.userId, t.updatedAt.desc())],
);
