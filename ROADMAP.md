# Roadmap

Where the project stands and what has to happen next, in order. Each step lists what
"done" means, so it can be checked rather than felt.

## Step 0 — what exists today ✅

- State machine, SQLite store, incremental GitHub sync, label reconciliation, approval
  gate, prompt templating, container runner, dashboard, Docker image.
- **Verified**: boots, serves the dashboard, degrades gracefully on bad credentials,
  and classifies a real 94-issue backlog (55 queued, 9 adopted as waiting, 30 excluded
  by label; with `require_label: approved`, 64 held in `needs_approval`).
- **Not verified**: the run path — workspace clone, `docker run`, settle. Never
  executed end to end.

## Step 1 — first real run 🎯

The one thing standing between this and a working product.

1. Create a throwaway public repo with two or three trivial issues (a typo in the
   README, a missing script in `package.json`).
2. Add a `.issue-auto-solve.yml` pointing at a plain `node:24-slim` image, no preflight,
   one check (`npm test` or `true`).
3. Run locally with `dispatch_enabled: true`, `max_concurrent_runs: 1`.

**Done when**: an issue goes `discovered → claimed → running → pr_open`, the pull
request exists on the right base branch, the run log is readable in the drawer, and a
second tick does *not* open a second pull request.

**Expect to fix here**: host path mapping for bind mounts (`HOST_WORKSPACE_DIR`), the
`git clone --reference-if-able` line, and the settle heuristics.

## Step 1b — onboarding from the dashboard ✅

- GitHub App created through the manifest flow, credentials stored encrypted in SQLite
  behind a key generated on first boot; Claude token pasted in the UI; repositories added
  and removed at runtime; **Generate config** opens a pull request adding
  `.issue-auto-solve.yml` written by the agent itself.
- **Verified**: boots with no credentials at all and says so, rejects a bad token, accepts
  a real one, stores nothing in clear text, and starts watching a repository added through
  the API without a restart.
- **Not verified**: the manifest round trip against GitHub, and the bootstrap run (it goes
  through the container runner, so step 1 covers it).

## Step 2 — GitHub App

Until this is done the agent writes under a human login and answer detection is
approximate.

- App with permissions: Issues (RW), Pull requests (RW), Contents (RW), Metadata (R).
- Webhook to `POST /webhooks/github`, events: `issues`, `issue_comment`,
  `pull_request`; secret in `GITHUB_WEBHOOK_SECRET`.
- Install it on the repositories to watch, switch `GITHUB_AUTH_MODE=app`.

**Done when**: the agent's comments show as `<app>[bot]`, a reply on a parked issue
requeues it within seconds rather than at the next poll, and installation tokens are
refreshed for runs longer than an hour.

## Step 3 — run it on itself

The project is one more repository in its own list.

- `.issue-auto-solve.yml` at the root: base branch, `npm ci` preflight, checks
  `npm run typecheck` and `npm run build`, `require_label: approved`.
- Guard rail: it must never redeploy itself mid-run. Deployment stays a separate step
  (watcher on merge, or a manual `docker compose up -d --build`).

**Done when**: an issue opened here produces a reviewable pull request, and merging it
does not disturb a run in flight.

## Step 4 — first issues to open here

Ordered by what unblocks the most.

**Runner and reliability**
1. Refresh the GitHub installation token for runs longer than one hour.
2. Garbage-collect `workspaces/` and rotate `logs/` (keep N runs per repository).
3. Handle a container that dies with the daemon unreachable — currently reported as a
   plain failure with no hint.
4. Retry policy: `max_runs_per_task` exists, but a failed run should record *why* in a
   way the next attempt can read.

**Deployment and Docker**
5. Publish the image to GHCR on tag, with `linux/amd64` and `linux/arm64`.
6. A `docker compose` profile that runs the dashboard read-only, without the Docker
   socket, for people who only want to watch.
7. Health endpoint good enough for a compose `healthcheck`, plus a restart-safe
   shutdown that lets in-flight runs finish.

**Build and CI**
8. GitHub Actions: typecheck, build, and a smoke test that boots the server and hits
   `/api/health`.
9. Lint and format (a single tool, no debate), enforced in CI.
10. Pin the Docker CLI version and check the image builds on both architectures.

**Dashboard**
11. **Authentication.** There is none today — anyone reaching the port can requeue or
    skip. Blocking before this is exposed anywhere.
12. Live log streaming (SSE) instead of re-fetching the whole file every four seconds.
13. Per-repository page: queue, history, error from the last sync.
14. Show the rendered prompt of a run — indispensable when the agent misbehaves and the
    question is "what did it actually read".

**Product**
15. `dry_run`: prepare the workspace and render the prompt, run nothing, keep the
    artefacts. The safest way to onboard a repository.
16. Cost tracking per run, so multiplying repositories is a decision and not a surprise.

## Step 5 — migrate Breem

Move `ilianAZZ/Breem-app` off the shell loop.

- Port the current prompt to `.issue-auto-solve.yml` + `.issue-auto-solve/prompt.md`.
- Reuse the existing agent image (Docker socket, Flutter, pnpm, decrypted `.env`).
- Run both side by side for a day with `dispatch_enabled: false` here, compare what each
  would pick, then stop the old loop.

**Done when**: the 9 issues currently parked are adopted with the right question
comment, and a reply on one of them produces a run.

## Step 6 — make it public

- No secret in the history; `secrets/` never committed.
- Screenshot of the dashboard in the README, topics set (`claude-code`, `github-issues`,
  `ai-agent`, `self-hosted`), MIT license already in place.
- `require_label: approved` documented as the default posture for public repositories.
- A `SECURITY.md` saying plainly what the agent can reach: a repository token, a
  container with a Docker socket if enabled, and the machine it runs on.

## Known gaps

| Gap | Consequence |
| --- | --- |
| Dashboard has no authentication | never expose the port directly |
| Runner never executed end to end | step 1 exists for this |
| Installation tokens expire after an hour | a run longer than that loses push rights |
| `workspaces/` and `logs/` grow forever | disk fills up silently |
| Headless Claude Code draws on the Agent SDK credit, not the interactive plan | cost scales with the number of repositories |
