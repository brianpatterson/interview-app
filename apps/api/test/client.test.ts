// The web app's typed client (packages/shared/src/client.ts) against the real server: the same
// code the browser runs, with fetch pointed at the app in-process instead of the network.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, makeApiClient } from '@roundtable/contract/client';
import { setupTestApp, signUp } from './helpers.js';

const t = setupTestApp();

const clientFor = (cookie?: string) =>
  makeApiClient({ baseUrl: 'http://localhost', fetch: t.fetchAs(cookie) });

let api: ReturnType<typeof clientFor>;

beforeAll(() => t.migrate());

beforeEach(async () => {
  await t.reset();
  api = clientFor((await signUp(t)).cookie);
});

afterAll(() => t.close());

describe('the web client', () => {
  it('creates, lists, updates and deletes, with dates decoded', async () => {
    const created = await api.createApplication({ company: ' Acme ', jobTitle: 'SWE' });

    expect(created).toMatchObject({ company: 'Acme', jobTitle: 'SWE', status: 'applied' });
    expect(created.createdAt).toBeInstanceOf(Date);

    const updated = await api.updateApplication(created.id, { status: 'offer' });

    expect(updated.status).toBe('offer');
    expect(await api.listApplications()).toEqual([updated]);

    await api.deleteApplication(created.id);
    expect(await api.listApplications()).toEqual([]);
  });

  it('reads the public auth config without a session', async () => {
    expect(await clientFor().authConfig()).toEqual({ providers: [] });
  });

  it('turns typed errors into messages for the user', async () => {
    const missing = api.updateApplication(crypto.randomUUID(), { status: 'offer' });

    await expect(missing).rejects.toThrow(ApiError);
    await expect(missing).rejects.toThrow('That application no longer exists.');
    await expect(clientFor().listApplications()).rejects.toThrow('You have been signed out');
  });

  it('refuses invalid input before sending it', async () => {
    let requests = 0;

    const counting = makeApiClient({
      baseUrl: 'http://localhost',
      fetch: (input, init) => {
        requests += 1;

        return t.fetchAs()(input, init);
      },
    });

    await expect(counting.createApplication({ company: '  ', jobTitle: 'SWE' })).rejects.toThrow(
      'must not be blank',
    );
    await expect(
      counting.createApplication({ company: 'A', jobTitle: 'B', jobUrl: 'javascript:alert(1)' }),
    ).rejects.toThrow('must be an http(s) URL');
    expect(requests).toBe(0);
  });
});
