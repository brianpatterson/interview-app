import { NewApplicationForm } from './NewApplicationForm';
import { ApplicationsTable } from './ApplicationsTable';

export function App({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  return (
    <main>
      <header className="app-header">
        <h1>Interview App</h1>
        <span>
          {userName} ·{' '}
          <button className="link" onClick={onSignOut}>
            Sign out
          </button>
        </span>
      </header>
      <NewApplicationForm />
      <ApplicationsTable />
    </main>
  );
}
