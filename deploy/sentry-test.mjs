// Sends one test event to Sentry from inside the running API container, using its own
// SENTRY_DSN and SENTRY_RELEASE. Proves the container has the DSN, the droplet can reach Sentry,
// and Sentry accepts the event. (The SDK wiring itself is covered by apps/api tests.)
//   ssh ops@<ipv4> 'cd /opt/interview-app && docker compose -f compose.prod.yml --env-file .env exec -T api node --input-type=module -' < deploy/sentry-test.mjs
// Uses only Node built-ins: the production image has no node_modules.
import { randomUUID } from 'node:crypto';

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error('✗ SENTRY_DSN is not set in the api container. Add it to .env and redeploy.');
  process.exit(1);
}

const { protocol, username: publicKey, host, pathname } = new URL(dsn);
const projectId = pathname.replace(/^\//, '');
const eventId = randomUUID().replaceAll('-', '');
const event = {
  event_id: eventId,
  timestamp: Date.now() / 1000,
  platform: 'node',
  level: 'info',
  logger: 'deploy/sentry-test.mjs',
  message: { formatted: 'Production Sentry test event (deploy/sentry-test.mjs)' },
  environment: process.env.NODE_ENV ?? 'production',
  release: process.env.SENTRY_RELEASE,
};
const envelope = [
  JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
  JSON.stringify({ type: 'event' }),
  JSON.stringify(event),
].join('\n');

const res = await fetch(`${protocol}//${host}/api/${projectId}/envelope/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-sentry-envelope',
    'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=sentry-test/1.0`,
  },
  body: envelope,
  signal: AbortSignal.timeout(10_000),
});

if (!res.ok) {
  console.error(`✗ Sentry answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
console.log(`✓ Sentry accepted test event ${eventId}`);
console.log(`  release: ${event.release ?? '(none)'}, environment: ${event.environment}`);
console.log(
  '  Find it in Sentry → Issues (search "Production Sentry test event"), then resolve it.',
);
