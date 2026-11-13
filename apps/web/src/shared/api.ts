import { makeApiClient } from '@roundtable/contract/client';

// The typed client from the contract (ADR-0022). Same origin: Vite proxies /api in dev, Caddy in
// production, so the session cookie goes with every call.
export const api = makeApiClient({ baseUrl: window.location.origin });
