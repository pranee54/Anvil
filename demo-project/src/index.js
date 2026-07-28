import { createApp } from './app.js'

const app = createApp()

console.log('Anvil demo — Task Board')
console.log('Login with username "demo" and password "demo"')

const bad = app.login('demo', '')
console.log('login(empty password) [intentional demo bug — should fail]:', {
  ok: bad.ok,
  token: bad.ok ? '(issued)' : undefined,
  error: bad.error
})

const ok = app.login('demo', 'demo')
console.log('login(demo/demo):', ok.ok ? { ok: true, user: ok.session.username } : ok)

if (ok.ok) {
  const created = app.createTask(ok.session.token, 'Ship Anvil screenshots')
  console.log('createTask:', created)
  console.log('listTasks:', app.listTasks(ok.session.token))
}
