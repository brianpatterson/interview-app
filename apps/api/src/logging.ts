import type { FastifyBaseLogger, FastifyServerOptions } from 'fastify';
import { redactQueryParamsInJson } from './redact.js';

// A type alias, not an interface: Fastify's serializer type has an index signature, which
// object-literal types satisfy implicitly.
type SerializedError = {
  type: string;
  message: string;
  stack: string;
};

/**
 * Logs an error as its type, message and stack, with every `cause` folded in, as pino's default
 * does. Unlike the default, other properties are left out: Drizzle's query error carries its
 * parameters as a `params` property, which can hold a session token.
 */
export function serializeError(err: Error): SerializedError {
  const messages: string[] = [];
  const stacks: string[] = [];
  let current: unknown = err;

  while (current instanceof Error) {
    messages.push(current.message);
    stacks.push(current.stack ?? `${current.name}: ${current.message}`);
    current = current.cause;
  }

  return { type: err.name, message: messages.join(': '), stack: stacks.join('\ncaused by: ') };
}

/** Pino options for the API's logger: what's above, plus a last pass over each finished line. */
export const loggerOptions = {
  serializers: { err: serializeError },
  hooks: {
    // Catches query parameters anywhere in the line, including messages Fastify copies from
    // `err.message` and errors logged under keys other than `err`.
    streamWrite: redactQueryParamsInJson,
  },
} satisfies Exclude<FastifyServerOptions['logger'], boolean | undefined>;

type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Better Auth's logger, sent through ours instead of `console`, so its lines get the same
 * redaction. Only an Error argument is kept: other arguments are free-form and unreviewed.
 */
export function betterAuthLogger(log: Pick<FastifyBaseLogger, BetterAuthLogLevel>) {
  return {
    log: (level: BetterAuthLogLevel, message: string, ...args: unknown[]) => {
      const err = args.find((arg) => arg instanceof Error);

      log[level](err ? { err } : {}, `[Better Auth] ${message}`);
    },
  };
}
