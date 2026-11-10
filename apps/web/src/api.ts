import {
  applicationSchema,
  type CreateApplicationInput,
  type UpdateApplicationInput,
} from '@roundtable/shared';

async function send(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);

  return res;
}

// Every response is parsed with the shared contract's schema, so a shape mismatch fails loudly here.
export const api = {
  listApplications: async () =>
    applicationSchema.array().parse(await (await send('/applications')).json()),
  createApplication: async (input: CreateApplicationInput) =>
    applicationSchema.parse(
      await (await send('/applications', { method: 'POST', body: JSON.stringify(input) })).json(),
    ),
  updateApplication: async (id: string, input: UpdateApplicationInput) =>
    applicationSchema.parse(
      await (
        await send(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
      ).json(),
    ),
  deleteApplication: async (id: string) => {
    await send(`/applications/${id}`, { method: 'DELETE' });
  },
};
