import { Schema } from 'effect';
import { Application } from '../src/Api.js';

const decode = Schema.decodeUnknownSync(Schema.Array(Application));
export const listApplications = async () => decode(await (await fetch('/api/applications')).json());
