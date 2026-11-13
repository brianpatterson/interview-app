// The email module's public interface (ADR-0023): other modules and server.ts import from here,
// never from the files behind it. Sends auth emails within the sending limits (ADR-0018).
export { DailyEmailLimitReached, Mailer, type EmailLimits } from './mailer.js';

export { emailSends } from './schema.js';

export {
  EmailSendFailed,
  EmailTransport,
  transportFromEnv,
  type Email,
  type EmailKind,
  type SendEmail,
} from './transport.js';
