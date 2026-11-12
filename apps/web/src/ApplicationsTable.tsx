import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPLICATION_STATUSES,
  isApplicationStatus,
  type ApplicationStatus,
} from '@roundtable/shared';
import { api } from './api';

const formatDate = (date: Date) => date.toLocaleDateString();

export function ApplicationsTable() {
  const queryClient = useQueryClient();
  const applications = useQuery({ queryKey: ['applications'], queryFn: api.listApplications });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['applications'] });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ApplicationStatus }) =>
      api.updateApplication(id, { status }),
    onSuccess: invalidate,
  });

  const remove = useMutation({ mutationFn: api.deleteApplication, onSuccess: invalidate });

  if (applications.isPending) return <p>Loading…</p>;

  if (applications.isError) return <p className="error">{applications.error.message}</p>;

  if (applications.data.length === 0) return <p>No applications yet. Add your first one above.</p>;

  const mutationError = updateStatus.error ?? remove.error;

  return (
    <>
      {mutationError && <p className="error">{mutationError.message}</p>}
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Job title</th>
            <th>Status</th>
            <th>Applied</th>
            <th>Last updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {applications.data.map((a) => (
            <tr key={a.id}>
              <td>{a.company}</td>
              <td>
                {a.jobUrl ? (
                  <a href={a.jobUrl} target="_blank" rel="noreferrer">
                    {a.jobTitle}
                  </a>
                ) : (
                  a.jobTitle
                )}
              </td>
              <td>
                <select
                  value={a.status}
                  onChange={(e) => {
                    const status = e.target.value;

                    if (isApplicationStatus(status)) updateStatus.mutate({ id: a.id, status });
                  }}
                >
                  {APPLICATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td>{formatDate(a.createdAt)}</td>
              <td>{formatDate(a.updatedAt)}</td>
              <td>
                <button
                  className="link"
                  onClick={() => {
                    if (confirm(`Delete ${a.company} – ${a.jobTitle}?`)) remove.mutate(a.id);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
