// The applications module's public interface (ADR-0023): server.ts imports from here, never from
// the files behind it. Owns job applications: their endpoints and their table.
export { ApplicationsLive } from './handlers.js';

export { applications, applicationStatus } from './schema.js';
