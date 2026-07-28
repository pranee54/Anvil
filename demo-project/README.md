# Anvil Demo — Task Board

Small **in-memory task board API** used to demonstrate Anvil (Ask / Edit / Agent, search, diffs).

No network server, no npm dependencies, no secrets, no personal paths.

## What it does

- **Login** with a demo user (`demo` / `demo`)
- List and create **tasks** for the logged-in user
- Basic validation and error helpers

Everything lives in memory for one Node process (`npm start`).

## Structure

```text
demo-project/
  package.json
  AGENTS.md
  README.md
  src/
    index.js           # smoke demo entry
    app.js             # wires auth + tasks API
    auth/
      login.js         # authenticateDemoUser
      session.js       # in-memory session store
    api/
      tasks.js         # listTasks / createTask
    lib/
      validate.js      # input checks
      errors.js        # AppError + formatError
```

## Run

```bash
npm start
```

## Intentional demo gaps

Useful for Edit / Agent demos (do not treat as production code):

- Empty password can still log in as `demo`
- `safeFormat` collapses unknown errors to `unexpected_error`

## Useful Anvil prompts

```text
Explain this project.
How does authentication work?
Find the API implementation.
Add validation to the login form.
Find a bug in this project.
Improve error handling.
```

## Capture note

When screenshotting Anvil with this folder open, keep the window title / explorer paths limited to `demo-project` — avoid exposing home-directory or machine-specific paths in the frame.
