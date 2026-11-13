// What the user sees when an API call fails. The contract's errors carry no message, so the
// wording lives here, one section per module. A new error in the contract needs a line here.
import { Schema } from 'effect';
import { ApplicationNotFound } from '../applications.js';
import { Unauthorized } from '../identity.js';

/** A failed API call, with a message fit to show the user. `cause` is the original error. */
export class ApiError extends Error {
  override name = 'ApiError';
}

// Identity
const isUnauthorized = Schema.is(Unauthorized);

// Applications
const isNotFound = Schema.is(ApplicationNotFound);

export function toApiError(cause: unknown): ApiError {
  if (isUnauthorized(cause))
    return new ApiError('You have been signed out. Sign in again.', { cause });

  if (isNotFound(cause)) return new ApiError('That application no longer exists.', { cause });

  // A request body the contract rejects, caught before it's sent: says which field and why.
  if (Schema.isSchemaError(cause)) return new ApiError(cause.message, { cause });

  return new ApiError('Something went wrong. Please try again.', { cause });
}
