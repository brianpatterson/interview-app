import { useState, type FormEvent } from 'react';
import { authClient } from './auth-client';

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (!token) return;
    const result = await authClient.resetPassword({ newPassword: password, token });

    if (result.error) return setError(result.error.message ?? 'Something went wrong');
    setDone(true);
  }

  return (
    <main className="auth">
      <h1>Roundtable</h1>
      <h2>Choose a new password</h2>
      {!token ? (
        <p className="error">This reset link is invalid or has expired.</p>
      ) : done ? (
        <p>
          Password updated. <a href="/">Sign in</a>
        </p>
      ) : (
        <form onSubmit={onSubmit}>
          <input
            placeholder="New password (10+ characters)"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit">Update password</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </main>
  );
}
