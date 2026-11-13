import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redacted, Schema } from 'effect';
import { AuthConfig } from '@roundtable/contract';
import { eq } from 'drizzle-orm';
import { accounts, users } from './schema.js';
import {
  env,
  setupTestApp,
  signUp,
  signUpUnverified,
  takeEmail,
  type TestApp,
} from '#test/helpers';

interface FakeGitHubUser {
  id: number;
  login: string;
  /** Public profile email; null makes the provider fall back to the email list. */
  email: string | null;
  emails: { email: string; primary: boolean; verified: boolean }[];
}

/** Answers GitHub's token, profile and email endpoints; everything else goes to the real fetch. */
function fakeGitHub(user: FakeGitHubUser) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url } = new Request(input);

    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return Response.json({
        access_token: 'gho_fake',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      });
    }

    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: user.id,
        login: user.login,
        name: user.login,
        email: user.email,
        avatar_url: null,
      });
    }

    if (url === 'https://api.github.com/user/emails') return Response.json(user.emails);

    return realFetch(input, init);
  });
}

/** Runs the whole browser round trip: start sign-in, then come back to the callback. */
async function signInWithGitHub(t: TestApp) {
  const start = await t.inject({
    method: 'POST',
    url: '/api/auth/sign-in/social',
    headers: { origin: env.BETTER_AUTH_URL },
    payload: { provider: 'github', callbackURL: '/', errorCallbackURL: '/' },
  });

  expect(start.statusCode).toBe(200);
  const authorizeUrl = new URL(start.json<{ url: string }>().url);
  const state = authorizeUrl.searchParams.get('state')!;
  const cookie = start.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const callback = await t.inject({
    method: 'GET',
    url: `/api/auth/callback/github?code=fake-code&state=${encodeURIComponent(state)}`,
    headers: { cookie },
  });

  return {
    authorizeUrl,
    status: callback.statusCode,
    location: callback.headers.location,
    signedIn: callback.cookies.some((c) => c.name.endsWith('session_token') && c.value),
  };
}

const githubUser = (email: string, verified = true): FakeGitHubUser => ({
  id: Math.floor(Math.random() * 1e9),
  login: 'octo',
  email: null,
  emails: [{ email, primary: true, verified }],
});

describe('GitHub sign-in', () => {
  const t = setupTestApp({
    env: { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: Redacted.make('gh-secret') },
  });

  beforeAll(() => t.migrate());
  beforeEach(() => t.reset());
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => t.close());

  it('lists GitHub as a provider once its credentials are set', async () => {
    const res = await t.inject({ method: 'GET', url: '/api/auth-config' });
    expect(Schema.decodeUnknownSync(AuthConfig)(res.json())).toEqual({ providers: ['github'] });
  });

  it('sends the browser to GitHub with our callback URL, state and the email scope', async () => {
    fakeGitHub(githubUser('new@example.com'));
    const { authorizeUrl } = await signInWithGitHub(t);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      `${env.BETTER_AUTH_URL}/api/auth/callback/github`,
    );
    expect(authorizeUrl.searchParams.get('scope')).toContain('user:email');
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
  });

  it('creates a verified account for a new GitHub user and signs them in', async () => {
    fakeGitHub(githubUser('new@example.com'));
    const result = await signInWithGitHub(t);
    expect(result).toMatchObject({ status: 302, location: '/', signedIn: true });
    const [user] = await t.db.select().from(users).where(eq(users.email, 'new@example.com'));
    expect(user?.emailVerified).toBe(true);
  });

  it('links GitHub to an existing verified account with the same email', async () => {
    const existing = await signUp(t, 'same@example.com');
    fakeGitHub(githubUser('same@example.com'));
    const result = await signInWithGitHub(t);
    expect(result).toMatchObject({ location: '/', signedIn: true });
    const linked = await t.db.select().from(accounts).where(eq(accounts.userId, existing.user.id));
    expect(linked.map((a) => a.providerId).sort()).toEqual(['credential', 'github']);
  });

  it('refuses to link to an account whose owner never confirmed the email (pre-hijacking)', async () => {
    // Someone registers the victim's address with their own password and never confirms it...
    const { email } = await signUpUnverified(t, 'victim@example.com');
    takeEmail(t, email, 'Confirm your email');
    // ...then the real owner signs in with GitHub. They must not land in that account.
    fakeGitHub(githubUser('victim@example.com'));
    const result = await signInWithGitHub(t);
    expect(result.signedIn).toBe(false);
    expect(result.location).toMatch(/^\/\?error=account_not_linked/);
  });

  it("refuses to link when GitHub hasn't verified the email", async () => {
    await signUp(t, 'owner@example.com');
    // An attacker's GitHub account lists the owner's address without having verified it.
    fakeGitHub(githubUser('owner@example.com', false));
    const result = await signInWithGitHub(t);
    expect(result.signedIn).toBe(false);
    expect(result.location).toMatch(/^\/\?error=/);
    const owner = await t.db.select().from(users).where(eq(users.email, 'owner@example.com'));
    const linked = await t.db.select().from(accounts).where(eq(accounts.userId, owner[0]!.id));
    expect(linked.map((a) => a.providerId)).toEqual(['credential']);
  });
});
