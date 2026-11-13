import { createAuthClient } from 'better-auth/react';

// Same origin: Vite (dev) or the reverse proxy (prod) routes /api/auth/* to the API.
export const authClient = createAuthClient();
