# Context7 library IDs

Use `resolve-library-id` then `query-docs` for up-to-date API docs.

## CLI dependencies

| Library | Context7 ID | Used for |
|---------|-------------|----------|
| Commander.js | `/tj/commander.js` | CLI command registration |
| Zod | `/colinhacks/zod` (v3.24.x in project) | Config schema validation |
| Vitest | `/vitest-dev/vitest` | Test framework + coverage |
| node-ssh | `/steelbrain/node-ssh` | Remote SSH sessions |

## Admin UI

| Library | Context7 ID | Used for |
|---------|-------------|----------|
| React | `/reactjs/react.dev` | Components, hooks |
| Vite | `/vitejs/vite` (v6.x in project) | Build tooling |

## Query tips

- Be specific in queries (e.g. "Commander subcommand with async action handler")
- Free tier: max 3 resolve + 3 query calls per question
- Do not include secrets, config values, or proprietary code in queries