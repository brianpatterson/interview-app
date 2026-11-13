import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

// Both timestamps come from Postgres's clock. Mixing in the API's clock (`new Date()`) lets an
// update land "before" the insert whenever the two machines' clocks drift apart.
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};
