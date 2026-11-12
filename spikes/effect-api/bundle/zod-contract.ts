import { applicationSchema } from '../../../packages/shared/src/index.js';

export const listApplications = async () =>
  applicationSchema.array().parse(await (await fetch('/api/applications')).json());
