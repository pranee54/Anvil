import { AppError, formatError } from './errors.js'

/**
 * @param {unknown} value
 * @param {string} label
 */
export function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('validation_error', `${label} is required`)
  }
  return value.trim()
}

/**
 * Intentionally weak on purpose for demo edits:
 * empty password currently slips through if callers skip requirePassword.
 * @param {unknown} password
 */
export function requirePassword(password) {
  if (typeof password !== 'string') {
    throw new AppError('validation_error', 'password must be a string')
  }
  // BUG (demo): empty string is accepted — good target for "Add validation to the login form"
  return password
}

/**
 * @param {unknown} title
 */
export function requireTaskTitle(title) {
  const text = requireNonEmptyString(title, 'title')
  if (text.length > 80) {
    throw new AppError('validation_error', 'title must be 80 characters or fewer')
  }
  return text
}

/**
 * Soft formatter used by the CLI — swallows non-AppError details (demo gap).
 * @param {unknown} err
 */
export function safeFormat(err) {
  if (err instanceof AppError) return formatError(err)
  // BUG (demo): loses original message — good target for "Improve error handling"
  return { ok: false, error: 'unexpected_error' }
}
