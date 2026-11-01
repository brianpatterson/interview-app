import type {
  Application,
  CreateApplicationInput,
  UpdateApplicationInput,
} from '@interview-app/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listApplications: () => request<Application[]>('/applications'),
  createApplication: (input: CreateApplicationInput) =>
    request<Application>('/applications', { method: 'POST', body: JSON.stringify(input) }),
  updateApplication: (id: string, input: UpdateApplicationInput) =>
    request<Application>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteApplication: (id: string) => request<void>(`/applications/${id}`, { method: 'DELETE' }),
};
