export class SafeError extends Error {
  constructor(public readonly code: string, message: string, public readonly outcomeUnknown = false) {
    super(message);
    this.name = 'SafeError';
  }
}

export function publicError(error: unknown) {
  if (error instanceof SafeError) {
    return { code: error.code, message: error.message, outcomeUnknown: error.outcomeUnknown };
  }
  // Never expose exception text, response bodies, request headers or stack traces.
  return { code: 'INTERNAL_ERROR', message: 'The operation failed. No diagnostic details were exposed.', outcomeUnknown: false };
}
