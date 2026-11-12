import { EffectDrizzleQueryError } from 'drizzle-orm/effect-core';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { Cause } from 'effect';
import { z } from 'zod';

// Drizzle's DrizzleQueryError message is "Failed query: <sql>\nparams: <values>". The values can be
// credentials: Better Auth looks sessions up by the raw token, so a failed lookup puts a live
// session token in the message. Everything that leaves the process (Sentry events, log lines)
// goes through these. They keep the SQL, which says which query failed, and replace the values
// with their shapes ("<redacted: uuid, string(32), null>") when the error object is at hand, or
// with "<redacted>" when only the text is.

/** Everything after "params: " in a Drizzle query error, up to any stack frames that follow. */
const QUERY_PARAMS = /(Failed query: [\s\S]*?\nparams: )(?!<redacted)(?:(?!\n\s+at )[\s\S])*/g;

/**
 * The same, inside a JSON string (a log line): newlines are the two characters `\n`, and the
 * match must stay within the string, so it consumes only string characters and escapes.
 */
const QUERY_PARAMS_IN_JSON =
  /(Failed query: (?:[^"\\]|\\.)*?\\nparams: )(?!<redacted)(?:(?!\\n\s+at )(?:[^"\\]|\\.))*/g;

export function redactQueryParams(text: string, replacement = '<redacted>'): string {
  return text.replace(QUERY_PARAMS, (_match, prefix: string) => prefix + replacement);
}

export function redactQueryParamsInJson(json: string): string {
  return json.replace(QUERY_PARAMS_IN_JSON, '$1<redacted>');
}

/**
 * A parameter's kind without its content: enough to spot "that should have been a uuid" or
 * "this was null". The first matching branch wins, so uuid comes before string.
 */
const paramKind = z
  .union([
    z.null().transform(() => 'null'),
    z.undefined().transform(() => 'undefined'),
    z.uuid().transform(() => 'uuid'),
    z.string().transform((value) => `string(${value.length})`),
    z.number().transform(() => 'number'),
    z.boolean().transform(() => 'boolean'),
    z.date().transform(() => 'date'),
    z.array(z.unknown()).transform((value) => `array(${value.length})`),
  ])
  .catch('object');

export function describeParams(params: readonly unknown[]): string {
  return params.length
    ? `<redacted: ${params.map((param) => paramKind.parse(param)).join(', ')}>`
    : '<redacted: none>';
}

/**
 * Every error in a `cause` chain, outermost first. Steps through Effect `Cause`s too: Drizzle's
 * Effect driver wraps the Postgres failure in one (EffectDrizzleQueryError → Cause → SqlError →
 * the Postgres error), and stopping there would lose why the query failed.
 */
export function causeChain(err: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = err;

  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = Cause.isCause(current.cause) ? Cause.squash(current.cause) : current.cause;
  }

  return chain;
}

/**
 * Postgres's diagnostic fields, as both drivers expose them (pg's DatabaseError, and the plain
 * error @effect/sql-pg raises). Only what describes the schema: `detail`, `hint`, `where` and
 * `internalQuery` can quote values ("Key (email)=(…) already exists"), so they're never read.
 */
const PostgresError = z.object({
  code: z.string().regex(/^[0-9A-Z]{5}$/),
  severity: z.string().optional(),
  schema: z.string().optional(),
  table: z.string().optional(),
  column: z.string().optional(),
  dataType: z.string().optional(),
  constraint: z.string().optional(),
  routine: z.string().optional(),
});

/**
 * SQLSTATE class 22 (data exception) messages quote the rejected input: `invalid input syntax
 * for type uuid: "…"`. Keep the message, drop what's in quotes.
 */
const redactDataException = (err: Error, text: string) => {
  const postgres = PostgresError.safeParse(err);

  return postgres.success && postgres.data.code.startsWith('22')
    ? text.replace(/"[^"]*"/g, '"<redacted>"')
    : text;
};

/** The parts of an error a person reads. */
export interface ErrorText {
  message: string;
  stack: string;
}

/**
 * An error's message and stack with any Drizzle query parameters replaced by their kinds (from
 * either driver), and quoted values removed from Postgres data-exception messages.
 */
export function describeError(err: Error): ErrorText {
  const stack = redactDataException(err, err.stack ?? `${err.name}: ${err.message}`);
  const message = redactDataException(err, err.message);

  const params =
    err instanceof DrizzleQueryError || err instanceof EffectDrizzleQueryError
      ? err.params
      : undefined;

  const paramSummary = params ? describeParams(params) : '<redacted>';

  return {
    message: redactQueryParams(message, paramSummary),
    stack: redactQueryParams(stack, paramSummary),
  };
}

/** Postgres's diagnostic fields from the first database error in the chain (see PostgresError). */
export function postgresFields(err: Error) {
  for (const link of causeChain(err)) {
    const postgres = PostgresError.safeParse(link);

    if (postgres.success) return postgres.data;
  }

  return undefined;
}
