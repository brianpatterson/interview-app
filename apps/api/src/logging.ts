import { Cause, Logger as EffectLogger, References } from 'effect';
import pino from 'pino';
import { causeChain, describeError, postgresFields, redactQueryParamsInJson } from './redact.js';

// A type alias, not an interface: Fastify's serializer type has an index signature, which
// object-literal types satisfy implicitly.
type SerializedError = {
  type: string;
  message: string;
  stack: string;
  /** Postgres's diagnostic fields (SQLSTATE code, table, constraint), when a cause has them. */
  postgres?: ReturnType<typeof postgresFields>;
};

/**
 * Logs an error as its type, message and stack, with every `cause` folded in, as pino's default
 * does. Unlike the default, other properties are left out: Drizzle's query error carries its
 * parameters as a `params` property, which can hold a session token. The parameters in the
 * message are replaced by their shapes, and Postgres's own diagnostic fields are kept.
 */
export function serializeError(err: Error): SerializedError {
  const chain = causeChain(err).map(describeError);

  const serialized: SerializedError = {
    type: err.name,
    message: chain.map((e) => e.message).join(': '),
    stack: chain.map((e) => e.stack).join('\ncaused by: '),
  };

  const postgres = postgresFields(err);

  if (postgres) serialized.postgres = postgres;

  return serialized;
}

/** Pino options for the API's logger: what's above, plus a last pass over each finished line. */
export const loggerOptions = {
  serializers: { err: serializeError },
  hooks: {
    // Catches query parameters anywhere in the line, including messages copied from an error's
    // message and errors logged under keys other than `err`.
    streamWrite: redactQueryParamsInJson,
  },
} satisfies pino.LoggerOptions;

/** The API's logger: JSON lines (pino), redacted as above. Promise code and Effect code share it. */
export type Log = pino.Logger;

/** To stdout, or to `stream` (tests read the lines). `enabled: false` writes nothing. */
export function createLogger(
  options: { stream?: { write(line: string): void }; enabled?: boolean } = {},
): Log {
  return pino(
    { ...loggerOptions, enabled: options.enabled ?? true },
    options.stream ?? process.stdout,
  );
}

const PINO_LEVELS = {
  All: 'trace',
  Trace: 'trace',
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Fatal: 'fatal',
  None: 'silent',
} as const;

/**
 * Effect's logger, sent to pino: log annotations become fields, and an error in the log entry's
 * Cause is logged as `err`, so it gets the serializer and redaction above.
 */
export function effectLoggerLayer(log: Log) {
  return EffectLogger.layer([
    EffectLogger.make(({ message, logLevel, cause, fiber }) => {
      const level = PINO_LEVELS[logLevel];

      if (level === 'silent') return;
      const annotations = fiber.getRef(References.CurrentLogAnnotations);
      const failed = Cause.hasFails(cause) || Cause.hasDies(cause);
      const text = [message].flat().map(String).join(' ');

      log[level](failed ? { ...annotations, err: Cause.squash(cause) } : annotations, text);
    }),
  ]);
}

type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Better Auth's logger, sent through ours instead of `console`, so its lines get the same
 * redaction. Only an Error argument is kept: other arguments are free-form and unreviewed.
 */
export function betterAuthLogger(log: Pick<Log, BetterAuthLogLevel>) {
  return {
    log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => {
      const err = args.find((arg) => arg instanceof Error);

      log[level](err ? { err } : {}, `[Better Auth] ${message}`);
    },
  };
}
