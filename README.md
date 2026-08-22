# issue-auto-solve

Self-hosted orchestrator that lets Claude Code work a GitHub backlog on its own, across
repositories, with a dashboard to watch it.

You do not assign issues to it. It watches the repositories you list, picks the next
eligible issue, runs Claude Code against it in a disposable container, opens a pull
request — and when the agent has to ask you something, it parks the issue and picks it
back up the moment you reply.

```
┌──────────────┐   poll / webhook   ┌──────────────┐   docker run   ┌─────────────┐
│  GitHub      │ ─────────────────► │  issue-auto-solve   │ ─────────────► │  claude -p  │
│  issues, PRs │ ◄───────────────── │  state + UI  │ ◄───────────── │  /workspace │
└──────────────┘   comment, PR      └──────────────┘   exit code    └─────────────┘
```

## Why

Backlog crawlers written as a shell loop all break the same way: the agent asks a
question, somebody answers, and nothing ever happens again. issue-auto-solve keeps the state
itself instead of asking the agent to re-derive it from the issue on every run.

| State | Meaning |
| --- | --- |
| `discovered` | eligible, waiting for a free slot |
| `claimed` / `running` | a container is working on it |
| `waiting_human` | the agent asked a question, we know which comment it was |
| `pr_open` | a pull request exists, issue-auto-solve is done |
| `needs_approval` | opened by anybody, waiting for a maintainer to approve it |
| `skipped` | excluded by label, or already has a branch or a pull request |
| `failed` | the run ended without a pull request, with a reason |

A question is answered when a comment posted **after** the agent's question comes from
somebody other than the agent. That is why the GitHub App mode matters: with a personal
token the agent writes under your own login and no rule can tell the two apart.

## Quick start

```bash
git clone https://github.com/<you>/issue-auto-solve && cd issue-auto-solve
docker compose up -d --build
open http://localhost:8420
```

The first screen is the setup, and it needs no text editor:

1. **GitHub** — one button creates the App from your browser through GitHub's manifest
   flow: GitHub sets the four permissions and three events itself and hands the
   credentials back, which are stored encrypted. A personal token also works, behind a
   disclosure, with the caveat that the agent then writes under your login.
2. **Claude** — Claude Code has no browser flow for third parties, so this step stays a
   terminal one: run `claude setup-token` and paste the result.
3. **Repositories** — add `owner/name`. **Generate config** then has the agent read the
   repository and open a pull request adding its `.issue-auto-solve.yml`.

Anything set in the environment wins over the dashboard and shows as locked there, so an
existing `.env` deployment keeps working untouched.

Start with `dispatch_enabled: false`: issue-auto-solve syncs, classifies and shows the whole
backlog without ever starting a run. Flip it once the dashboard shows what you expect.

### Credentials

| Variable | What it is |
| --- | --- |
| `GITHUB_AUTH_MODE=app` | recommended. `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY_FILE`, installed on the repositories you list. The agent gets its own identity, and webhooks make replies instant. |
| `GITHUB_AUTH_MODE=token` | quicker to set up, one `GITHUB_TOKEN`. The agent then writes under your login: answers are still detected, but only from the issue's comment order. |
| `CLAUDE_CODE_OAUTH_TOKEN` | from `claude setup-token`. Headless Claude Code usage is billed against the Agent SDK credit of your plan, not the interactive pool — worth checking before you run several repositories at once. |

Point the GitHub App webhook at `POST /webhooks/github` (`issues`, `issue_comment`,
`pull_request`) if you want reactions in seconds instead of at the next poll. Webhooks
are an accelerator, never a requirement: polling alone is enough.

## Configuring a repository

Global defaults live in `config/issue-auto-solve.yml`. Anything a repository needs to change
goes in a `.issue-auto-solve.yml` **at the root of that repository**, so a new project is one
file away and nothing is duplicated here:

```yaml
base_branch: dev
labels:
  exclude: [legal, security, complex]
  waiting: needs-human-input
runtime:
  image: ghcr.io/acme/my-agent-image:latest
  docker_socket: true
  env: [ENVIRONMENT_PASSWORD]
preflight:
  - pnpm install --frozen-lockfile
checks:
  - name: types
    run: pnpm build
prompt:
  file: .issue-auto-solve/prompt.md
```

See [examples/.issue-auto-solve.yml](examples/.issue-auto-solve.yml) for every key.

**The prompt is configuration too.** [prompts/default.md](prompts/default.md) is a
template rendered with `{{repo}}`, `{{issue_number}}`, `{{branch}}`, `{{base_branch}}`,
`{{checks}}`, the issue body and its conversation. Set `prompt.file` to replace it
entirely per repository, and `prompt.variables` to inject your own.

## Approval gate (public repositories)

On a public repository anybody can open an issue, and an agent that picks up whatever
arrives is a liability. Set an approval label and nothing moves without a maintainer:

```yaml
selection:
  require_label: approved
  trusted_associations: [OWNER, MEMBER, COLLABORATOR]
```

Issues without the label sit in `needs_approval` — visible in the dashboard, never
claimed, never read by the agent. Adding that label already requires triage permission
on GitHub, so the label *is* the gate; `trusted_associations` narrows it further by who
opened the issue. Remove the label and the issue goes back to waiting for approval.

## Labels are the remote control

- an excluded label takes an issue out of the queue, removing it puts it back;
- the waiting label parks an issue — including issues already carrying it when you plug
  a repository in, which are adopted rather than re-run;
- removing the waiting label by hand requeues the issue immediately.

## How a run works

1. A workspace is cloned from a local mirror and put on `agent/issue-<n>`, branched from
   the base branch.
2. `runtime.setup` then `preflight` run in the container; their output lands in
   `/control/preflight.log`, readable by the agent.
3. `claude -p` runs against the rendered prompt with the repository checked out at
   `/workspace` and a scoped GitHub token in `GH_TOKEN`.
4. issue-auto-solve settles the outcome from GitHub, not from what the agent claims: a pull
   request on the branch means done, a fresh comment from the agent means waiting,
   anything else is a failure with a reason.

Runs are capped by `max_concurrent_runs` globally and per repository, by
`timeout_minutes`, and by `max_runs_per_task` so a hopeless issue cannot loop forever.

## Dashboard

One page, one filter bar, every repository: what is running now, what is waiting on you
and for how long, what was skipped and why, the last pull requests, and the full log of
any run. Requeue or skip an issue from the drawer.

## Documentation

- [docs/TESTING.md](docs/TESTING.md) — try it locally, with and without Docker
- [docs/GITHUB-APP.md](docs/GITHUB-APP.md) — create the bot identity
- [ROADMAP.md](ROADMAP.md) — what works, what is next, what is untested

## Security

The dashboard is authenticated with a token generated on first boot and printed in the
log; `.issue-auto-solve.yml` cannot grant itself the Docker socket or the orchestrator's
environment variables; run logs are scrubbed of both tokens as they are written. The
threat model, and what is deliberately *not* protected, is in [SECURITY.md](SECURITY.md).

## Roadmap

What works, what is next and what is still untested: [ROADMAP.md](ROADMAP.md).

## Development

```bash
npm install
npm run dev          # requires Node 24 for node:sqlite
npm run typecheck
```

`state/` holds the SQLite database, `workspaces/` the clones, `logs/` one file per run.
All three are disposable: delete them and issue-auto-solve rebuilds its view from GitHub.

## License

MIT
