import { AppError } from '../lib/errors.js'
import { requireTaskTitle } from '../lib/validate.js'
import { getSession } from '../auth/session.js'

/** @type {Map<string, Array<{ id: string, title: string, done: boolean, ownerId: string }>>} */
const tasksByUser = new Map()

/**
 * @param {string} token
 */
function requireUser(token) {
  const session = getSession(token)
  if (!session) throw new AppError('unauthorized', 'Valid session required')
  return session
}

/**
 * @param {string} token
 */
export function listTasks(token) {
  const session = requireUser(token)
  return [...(tasksByUser.get(session.userId) || [])]
}

/**
 * @param {string} token
 * @param {string} title
 */
export function createTask(token, title) {
  const session = requireUser(token)
  const clean = requireTaskTitle(title)
  const task = {
    id: `task_${Math.random().toString(36).slice(2, 8)}`,
    title: clean,
    done: false,
    ownerId: session.userId
  }
  const list = tasksByUser.get(session.userId) || []
  list.push(task)
  tasksByUser.set(session.userId, list)
  return task
}
