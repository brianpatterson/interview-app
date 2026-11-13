import { describe, expect, it } from 'vitest';
import { Redacted } from 'effect';
import { loadEnv } from './env.js';
import { createLogger } from '../observability/logging.js';

const secret = 'test-secret-that-is-at-least-32-characters-long';

const baseEnv = {
  DATABASE_URL: 'postgres://app:db-password@localhost/app',
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: 'https://example.com',
};

describe('loadEnv', () => {
  it('requires a real mailer in production', () => {
    expect(() => loadEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(/RESEND_API_KEY/);
    expect(() =>
      loadEnv({ ...baseEnv, NODE_ENV: 'production', RESEND_API_KEY: '', EMAIL_FROM: '' }),
    ).toThrow(/RESEND_API_KEY/);

    const key = loadEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      RESEND_API_KEY: 're_x',
      EMAIL_FROM: 'a@b.c',
    }).RESEND_API_KEY;

    expect(key && Redacted.value(key)).toBe('re_x');
  });

  it('allows the log mailer outside production', () => {
    expect(loadEnv(baseEnv).RESEND_API_KEY).toBeUndefined();
  });

  it('treats blank variables as unset and applies defaults', () => {
    const env = loadEnv({
      ...baseEnv,
      GITHUB_CLIENT_ID: '',
      API_PORT: '',
      EMAIL_LIMIT_PER_DAY: '5',
    });

    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.API_PORT).toBe(3001);
    expect(env.EMAIL_LIMIT_PER_DAY).toBe(5);
  });

  it('names the invalid variable', () => {
    expect(() => loadEnv({ ...baseEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
    expect(() => loadEnv({ ...baseEnv, BETTER_AUTH_URL: 'not a url' })).toThrow(/BETTER_AUTH_URL/);
    expect(() => loadEnv({ ...baseEnv, EMAIL_LIMIT_PER_DAY: '0' })).toThrow(/EMAIL_LIMIT_PER_DAY/);
  });
});

describe('secrets stay out of logs and errors', () => {
  const env = loadEnv({
    ...baseEnv,
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-client-secret-value',
    RESEND_API_KEY: 're_api_key_value',
    SENTRY_DSN: 'https://dsn-key-value@o0.ingest.sentry.io/0',
  });

  const secrets = [
    secret,
    'db-password',
    'gh-client-secret-value',
    're_api_key_value',
    'dsn-key-value',
  ];

  it('the whole env, logged or serialised, shows none of them', () => {
    const lines: string[] = [];
    const log = createLogger({ stream: { write: (line) => void lines.push(line) } });

    log.info({ env }, 'config');
    const outputs = [JSON.stringify(env), String(env.BETTER_AUTH_SECRET), lines.join('\n')];

    for (const output of outputs) {
      for (const value of secrets) expect(output).not.toContain(value);
    }

    expect(lines.join('\n')).toContain('gh-id');
  });

  it('a rejected secret is not echoed in the startup error', () => {
    const tooShort = 'short-but-real-secret';

    expect(() => loadEnv({ ...baseEnv, BETTER_AUTH_SECRET: tooShort })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(tooShort) }),
    );
  });
});
