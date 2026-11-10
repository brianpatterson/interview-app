import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
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

/** Every error in a `cause` chain, outermost first. */
export function causeChain(err: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = err;

  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }

  return chain;
}

/** The parts of an error a person reads. */
export interface ErrorText {
  message: string;
  stack: string;
}

/** An error's message and stack with any Drizzle query parameters replaced by their kinds. */
export function describeError(err: Error): ErrorText {
  const stack = err.stack ?? `${err.name}: ${err.message}`;

  if (!(err instanceof DrizzleQueryError)) {
    return { message: redactQueryParams(err.message), stack: redactQueryParams(stack) };
  }

  const paramSummary = describeParams(err.params);

  return {
    message: redactQueryParams(err.message, paramSummary),
    stack: redactQueryParams(stack, paramSummary),
  };
}

/**
 * Postgres's diagnostic fields from the first database error in the chain: what failed and where
 * in the schema (SQLSTATE code, table, constraint). Left out: `detail`, `hint`, `where` and
 * `internalQuery`, which can quote values ("Key (email)=(…) already exists").
 */
export function postgresFields(err: Error) {
  const dbError = causeChain(err).find((e) => e instanceof pg.DatabaseError);

  if (!dbError) return undefined;

  const { code, severity, schema, table, column, dataType, constraint, routine } = dbError;
  const fields = { code, severity, schema, table, column, dataType, constraint, routine };

  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
