import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';
import { App } from './App';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage } from './SignInPage';

export function AuthGate() {
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

  return <App userName={session.data.user.name} onSignOut={signOut} />;
}
