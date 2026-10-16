// Errors that are safe to show to API clients. Anything else becomes a generic
// 500 so internal details (stack traces, upstream URLs, keys) never leak.

export class AppError extends Error {
  /**
   * @param {number} status HTTP status to return
   * @param {string} code stable machine-readable code
   * @param {string} message safe, user-facing message
   * @param {{ retryAfterSeconds?: number, cause?: unknown }} [options]
   */
  constructor(status, code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** @param {string} message */
export const badRequest = (message) => new AppError(400, "bad_request", message);

/** @param {string} nickname */
export const playerNotFound = (nickname) =>
  new AppError(404, "player_not_found", `No FACEIT player found with nickname "${nickname}".`);

/** @param {number} [retryAfterSeconds] @param {unknown} [cause] */
export const upstreamBusy = (retryAfterSeconds = 30, cause) =>
  new AppError(503, "upstream_busy", "The service is busy right now. Please try again shortly.", {
    retryAfterSeconds,
    cause,
  });

/** @param {unknown} [cause] */
export const upstreamFailed = (cause) =>
  new AppError(502, "upstream_error", "FACEIT could not be reached. Please try again later.", { cause });
