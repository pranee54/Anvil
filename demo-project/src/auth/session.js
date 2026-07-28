const sessions = new Map()

/**
 * @param {string} userId
 * @param {string} username
 */
export function createSession(userId, username) {
  const token = `sess_${Math.random().toString(36).slice(2, 10)}`
  const session = { token, userId, username, createdAt: Date.now() }
  sessions.set(token, session)
  return session
}

/**
 * @param {string} token
 */
export function getSession(token) {
  return sessions.get(token) || null
}

export function clearSessions() {
  sessions.clear()
}
