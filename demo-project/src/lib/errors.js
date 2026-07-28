export class AppError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

/**
 * @param {AppError} err
 */
export function formatError(err) {
  return { ok: false, error: err.code, message: err.message }
}
