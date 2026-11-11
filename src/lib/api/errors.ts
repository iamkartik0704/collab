/** An error with a stable machine-readable `code` that is safe to show to API clients. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Errors = {
  badRequest: (code: string, message: string, details?: unknown) => new ApiError(400, code, message, details),
  unauthorized: () => new ApiError(401, "unauthorized", "Sign in to continue."),
  tokenExpired: () =>
    new ApiError(401, "token_expired", "Your session needs refreshing.", undefined, {
      "WWW-Authenticate": 'Bearer error="invalid_token", error_description="access token expired"',
    }),
  forbidden: () => new ApiError(403, "forbidden", "You do not have permission to do that."),
  notFound: (what: string) => new ApiError(404, "not_found", `${what} was not found.`),
  conflict: (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details),
  unprocessable: (code: string, message: string, details?: unknown) => new ApiError(422, code, message, details),
  tooManyRequests: (headers: Record<string, string>) =>
    new ApiError(429, "rate_limited", "Too many requests. Please slow down.", undefined, headers),
  unavailable: (message = "Service temporarily unavailable. Please retry.") =>
    new ApiError(503, "service_unavailable", message),
  badGateway: (message: string) => new ApiError(502, "upstream_error", message),
};
