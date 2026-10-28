import { useEffect, useState } from 'react';
import type { HealthResponse } from '@interview-app/shared';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 32 }}>
      <h1>Interview App</h1>
      {error && <p>API error: {error}</p>}
      {health ? (
        <p>
          API: {health.ok ? 'up' : 'down'} · Database: {health.db}
        </p>
      ) : (
        !error && <p>Checking API…</p>
      )}
    </main>
  );
}
