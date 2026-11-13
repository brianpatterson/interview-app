import { ApplicationsPage } from '../modules/applications';
import { AuthGate } from '../modules/identity';

// The shell (ADR-0023): composes the modules and owns the layout around them. Modules never
// import each other or the shell; what one needs from another arrives here as props.
export function App() {
  return (
    <AuthGate>
      {({ userName, signOut }) => (
        <main>
          <header className="app-header">
            <h1>Roundtable</h1>
            <span>
              {userName} ·{' '}
              <button className="link" onClick={signOut}>
                Sign out
              </button>
            </span>
          </header>
          <ApplicationsPage />
        </main>
      )}
    </AuthGate>
  );
}
