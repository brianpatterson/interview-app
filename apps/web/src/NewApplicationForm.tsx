import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export function NewApplicationForm() {
  const queryClient = useQueryClient();
  const [company, setCompany] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobUrl, setJobUrl] = useState('');

  const create = useMutation({
    mutationFn: api.createApplication,
    onSuccess: () => {
      setCompany('');
      setJobTitle('');
      setJobUrl('');

      return queryClient.invalidateQueries({ queryKey: ['applications'] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate({ company, jobTitle, jobUrl: jobUrl || null });
  }

  return (
    <form className="new-application" onSubmit={onSubmit}>
      <input
        placeholder="Company"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        required
      />
      <input
        placeholder="Job title"
        value={jobTitle}
        onChange={(e) => setJobTitle(e.target.value)}
        required
      />
      <input
        placeholder="Job description link (optional)"
        type="url"
        value={jobUrl}
        onChange={(e) => setJobUrl(e.target.value)}
      />
      <button type="submit" disabled={create.isPending}>
        Add
      </button>
      {create.isError && <p className="error">{create.error.message}</p>}
    </form>
  );
}
