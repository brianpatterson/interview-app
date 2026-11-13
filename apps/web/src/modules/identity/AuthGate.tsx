import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage } from './SignInPage';

/** What the signed-in part of the app gets from identity. */
export interface SignedIn {
  readonly userName: string;
  readonly signOut: () => Promise<void>;
}

/**
 * Shows the sign-in and password-reset pages until there's a session, then renders `children`
 * with the signed-in user. The shell decides what that is, so identity never imports the shell.
 */
export function AuthGate({ children }: { children: (signedIn: SignedIn) => ReactNode }) {
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  // The client re-checks the session after sign-in/sign-up calls. Showing "Loading…" for those
  // re-checks would unmount the sign-in page and lose its state (like "check your email").
  const [loadedOnce, setLoadedOnce] = useState(false);

  if (!session.isPending && !loadedOnce) setLoadedOnce(true);

  if (window.location.pathname === '/reset-password') return <ResetPasswordPage />;

  if (session.isPending && !loadedOnce) return <main>Loading…</main>;

  if (!session.data) return <SignInPage />;

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
  }

  return children({ userName: session.data.user.name, signOut });
}
