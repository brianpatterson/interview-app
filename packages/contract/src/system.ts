// The API's own endpoints, not part of any module: the health check deploys and uptime monitors use.
import { Schema } from 'effect';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

export const Health = Schema.Struct({
  ok: Schema.Boolean,
  db: Schema.Literals(['up', 'down']),
  time: Schema.String,
});

export type Health = typeof Health.Type;

/** Public endpoints. */
export class SystemApi extends HttpApiGroup.make('system').add(
  HttpApiEndpoint.get('health', '/api/health', { success: Health }),
) {}
