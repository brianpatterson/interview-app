import { ApplicationsTable } from './ApplicationsTable';
import { NewApplicationForm } from './NewApplicationForm';

/** The applications module's root: everything the shell shows for it. */
export function ApplicationsPage() {
  return (
    <>
      <NewApplicationForm />
      <ApplicationsTable />
    </>
  );
}
