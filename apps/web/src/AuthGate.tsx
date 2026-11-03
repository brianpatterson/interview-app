import { useQueryClient } from '@tanstack/react-query';
import { authClient } from './auth-client';
import { App } from './App';
import { ResetPasswordPage } from './ResetPasswordPage';
import { SignInPage } from './SignInPage';

export function AuthGate() {
  const queryClient = useQueryClient();
  const session = authClient.useSession();

  if (window.location.pathname === '/reset-password') return <ResetPasswordPage />;
  if (session.isPending) return <main>Loading…</main>;
  if (!session.data) return <SignInPage />;

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
  }

  return <App userName={session.data.user.name} onSignOut={signOut} />;
}
