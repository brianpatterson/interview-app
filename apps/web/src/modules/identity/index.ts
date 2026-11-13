// The identity module's public interface (ADR-0023): the shell imports from here, never from the
// files behind it. Sign-in, sign-up, password reset, and the session gate around the app.
export { AuthGate, type SignedIn } from './AuthGate';
