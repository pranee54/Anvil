import { AppError } from '../lib/errors.js'
import { requireNonEmptyString, requirePassword } from '../lib/validate.js'
import { createSession } from './session.js'

/** Demo-only credentials — not real secrets. */
const DEMO_USER = {
  id: 'user_demo',
  username: 'demo',
  // Plaintext on purpose for a tiny public sample (not production auth).
  password: 'demo'
}

/**
 * Authenticate the built-in demo user and return a session token.
 * @param {string} username
 * @param {string} password
 */
export function authenticateDemoUser(username, password) {
  const user = requireNonEmptyString(username, 'username')
  const pass = requirePassword(password)

  // BUG (demo): empty password bypasses the credential check after weak requirePassword.
  // Good target for "Add validation to the login form" / "Find a bug in this project".
  if (user === DEMO_USER.username && (pass === DEMO_USER.password || pass === '')) {
    return createSession(DEMO_USER.id, DEMO_USER.username)
  }

  throw new AppError('auth_failed', 'Invalid username or password')
}
