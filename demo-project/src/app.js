import { authenticateDemoUser } from './auth/login.js'
import { createTask, listTasks } from './api/tasks.js'
import { safeFormat } from './lib/validate.js'

/**
 * In-memory Task Board API surface used by the smoke demo and by Anvil.
 */
export function createApp() {
  return {
    /**
     * @param {string} username
     * @param {string} password
     */
    login(username, password) {
      try {
        return { ok: true, session: authenticateDemoUser(username, password) }
      } catch (err) {
        return safeFormat(err)
      }
    },

    /**
     * @param {string} token
     */
    listTasks(token) {
      try {
        return { ok: true, tasks: listTasks(token) }
      } catch (err) {
        return safeFormat(err)
      }
    },

    /**
     * @param {string} token
     * @param {string} title
     */
    createTask(token, title) {
      try {
        return { ok: true, task: createTask(token, title) }
      } catch (err) {
        return safeFormat(err)
      }
    }
  }
}
