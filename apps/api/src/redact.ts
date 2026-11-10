// Drizzle's DrizzleQueryError message is "Failed query: <sql>\nparams: <values>". The values can be
// credentials: Better Auth looks sessions up by the raw token, so a failed lookup puts a live
// session token in the message. Everything that leaves the process (Sentry events, log lines)
// goes through these. They keep the SQL, which says which query failed, and drop only the values.

/** Everything after "params: " in a Drizzle query error, up to any stack frames that follow. */
const QUERY_PARAMS = /(Failed query: [\s\S]*?\nparams: )(?:(?!\n\s+at )[\s\S])*/g;

/**
 * The same, inside a JSON string (a log line): newlines are the two characters `\n`, and the
 * match must stay within the string, so it consumes only string characters and escapes.
 */
const QUERY_PARAMS_IN_JSON =
  /(Failed query: (?:[^"\\]|\\.)*?\\nparams: )(?:(?!\\n\s+at )(?:[^"\\]|\\.))*/g;

export function redactQueryParams(text: string): string {
  return text.replace(QUERY_PARAMS, '$1[redacted]');
}

export function redactQueryParamsInJson(json: string): string {
  return json.replace(QUERY_PARAMS_IN_JSON, '$1[redacted]');
}
