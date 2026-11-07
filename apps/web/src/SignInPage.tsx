import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authClient } from './auth-client';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

const providerLabels = { github: 'GitHub', google: 'Google' } as const;

export function SignInPage() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // A bad or expired verification link lands on /?error=… (set by the API's redirect).
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has('error')
      ? 'That confirmation link is invalid or has expired. Sign in to get a new one.'
      : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Drop ?error=… from the address bar so a reload doesn't show it again.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const config = useQuery({
    queryKey: ['auth-config'],
    queryFn: async () =>
      (await fetch('/api/auth-config')).json() as Promise<{
        providers: (keyof typeof providerLabels)[];
      }>,
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const result =
      mode === 'sign-in'
        ? await authClient.signIn.email({ email, password })
        : mode === 'sign-up'
          ? await authClient.signUp.email({ email, password, name, callbackURL: '/' })
          : await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setPending(false);
    if (result.error) {
      if (result.error.code === 'EMAIL_NOT_VERIFIED') {
        return setNotice(`Confirm your email first: check ${email} (and spam) for the link.`);
      }
      return setError(result.error.message ?? 'Something went wrong');
    }
    if (mode === 'sign-up') {
      setPassword('');
      setNotice(`Check ${email} for a link to finish creating your account.`);
    }
    if (mode === 'forgot') setNotice('If that email has an account, a reset link is on its way.');
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  return (
    <main className="auth">
      <h1>Interview App</h1>
      <h2>
        {mode === 'sign-in'
          ? 'Sign in'
          : mode === 'sign-up'
            ? 'Create an account'
            : 'Reset password'}
      </h2>

      {mode !== 'forgot' && config.data && config.data.providers.length > 0 && (
        <>
          <div className="providers">
            {config.data.providers.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => authClient.signIn.social({ provider, callbackURL: '/' })}
              >
                Continue with {providerLabels[provider]}
              </button>
            ))}
          </div>
          <p className="divider">or</p>
        </>
      )}

      <form onSubmit={onSubmit}>
        {mode === 'sign-up' && (
          <input
            placeholder="Name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
        <input
          placeholder="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'forgot' && (
          <input
            placeholder="Password (10+ characters)"
            type="password"
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
        <button type="submit" disabled={pending}>
          {mode === 'sign-in'
            ? 'Sign in'
            : mode === 'sign-up'
              ? 'Create account'
              : 'Send reset link'}
        </button>
        {error && <p className="error">{error}</p>}
        {notice && <p>{notice}</p>}
      </form>

      <p className="auth-links">
        {mode === 'sign-in' ? (
          <>
            <button className="link" onClick={() => switchMode('sign-up')}>
              Create an account
            </button>
            {' · '}
            <button className="link" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button className="link" onClick={() => switchMode('sign-in')}>
            Back to sign in
          </button>
        )}
      </p>
    </main>
  );
}
