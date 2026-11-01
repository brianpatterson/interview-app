# 0003. PostgreSQL as the system of record

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

The data is relational and small: applications, and soon users and status events. It needs
integrity constraints and transactions, and will need per-user filtering.

## Options considered

1. **PostgreSQL**: relational, strong constraints, enums, JSONB if ever needed. Every cloud
   offers a managed version.
2. **SQLite**: zero ops, great for one user. Concurrent writers and multi-instance deploys get
   awkward (LiteFS/Turso can help, but that's niche knowledge).
3. **MongoDB or DynamoDB**: flexible schema, but the data is naturally relational, and DynamoDB
   access patterns have to be designed up front.

## Decision

PostgreSQL 17. Run it in Docker locally and on a managed service in production.

## Consequences

- Local dev needs Docker (OrbStack).
- The skills transfer directly to most backend interviews (indexes, transactions, migrations).
