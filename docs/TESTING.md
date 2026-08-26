# Testing it locally

Two phases. The first needs nothing but a GitHub token and answers "does it read my
backlog correctly". The second needs Docker and answers "does it actually produce a
pull request".

## Prerequisites

| | |
| --- | --- |
| Node | 24 for `node:sqlite`. On Node 22, use the `:node22` scripts, which pass `--experimental-sqlite`. |
| GitHub | `gh auth token` is enough to start. The GitHub App comes later, see [GITHUB-APP.md](GITHUB-APP.md). |
| Claude | `claude setup-token` prints a token for `CLAUDE_CODE_OAUTH_TOKEN`. Only needed in phase 2. |
| Docker | Only for phase 2. The daemon must be running — `docker info` has to answer. |

## Phase 1 — watch only, no Docker, no risk

`dispatch_enabled: false` means it syncs, classifies and displays, and never starts a
run. This is also how you onboard any new repository.

```bash
git clone https://github.com/<you>/issue-auto-solve && cd issue-auto-solve
npm install

cat > config/local.yml <<'YAML'
poll_interval_seconds: 120
max_concurrent_runs: 1
dispatch_enabled: false
defaults:
  base_branch: main
  labels:
    exclude: [legal, security]
    waiting: needs-human-input
repositories:
  - repo: <you>/<some-repo>
    enabled: true
YAML

GITHUB_AUTH_MODE=token GITHUB_TOKEN="$(gh auth token)" \
CLAUDE_CODE_OAUTH_TOKEN=unused \
CONFIG_FILE=./config/local.yml \
npm run dev            # npm run dev:node22 on Node 22
```

Open http://localhost:8420. Within a minute the dashboard should show your issues split
between *Queued*, *Waiting on you*, *Needs approval* and *Skipped*.

**What to check**: the counts match what you expect, excluded labels really are in
*Skipped* with the reason, and any issue already carrying the waiting label is adopted
rather than queued.

Reset at any time: `rm -rf state/` — everything is rebuilt from GitHub.

## Phase 2 — one real run

Do this on a throwaway repository first, never on something you care about.

1. **A sandbox repository** with two trivial issues, for instance "the README says
   `intall` instead of `install`".

2. **A `.issue-auto-solve.yml` at its root:**

```yaml
version: 1
base_branch: main
runtime:
  image: node:24-slim
  setup:
    - apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates gnupg
    - install -d -m 755 /etc/apt/keyrings && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && apt-get update && apt-get install -y --no-install-recommends gh
    - npm install -g @anthropic-ai/claude-code
checks:
  - name: nothing to run here
    run: "true"
```

The image must contain `git`, `gh` (the default prompt uses it for issue comments and pull
requests), and the `claude` binary. Installing Claude Code in `setup` on every run is fine
to start with; bake it into your own image once it works.

3. **Start with dispatch on:**

```bash
docker info >/dev/null || echo "start Docker first"

sed -i '' 's/dispatch_enabled: false/dispatch_enabled: true/' config/local.yml

GITHUB_AUTH_MODE=token GITHUB_TOKEN="$(gh auth token)" \
CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.claude-oauth-token)" \
CONFIG_FILE=./config/local.yml \
npm run dev
```

4. **Watch it.** The task should go `discovered → claimed → running → pr_open`. Click the
row: the drawer streams the run log, including the exact `docker run` line and
everything Claude printed.

**Done when** the pull request exists on the right base branch, and a second tick leaves
it alone instead of opening a second one.

## When it goes wrong

| Symptom | Cause |
| --- | --- |
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. |
| Container starts but `/workspace` is empty | Bind mount paths. Running inside Docker requires `HOST_WORKSPACE_DIR` and `HOST_STATE_DIR` set to host paths — see `docker-compose.yml`. |
| `claude: not found` | The image has no Claude Code. Add it in `runtime.setup` or bake it in. |
| Run ends, state is `failed`, log looks fine | No pull request on the branch and no fresh comment: the agent did the work but never pushed. Read the end of the log. |
| Everything sits in `needs_approval` | `require_label` is set and no issue carries it. |
| `SQLite is an experimental feature` | Node 22. Harmless, or move to Node 24. |
| Nothing is discovered | The sync is incremental. `rm -rf state/` forces a full pass. |
