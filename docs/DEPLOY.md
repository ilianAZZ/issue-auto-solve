# Going to production

The order matters: one real run on something disposable, *then* your own repositories.
The runner is the only part that has never been exercised end to end.

## 1. The host

Docker and the compose plugin, and a user in the `docker` group. Nothing else — the
orchestrator ships its own Node and its own Docker CLI.

**No clone needed.** One compose file, and the published image:

```bash
mkdir issue-auto-solve && cd issue-auto-solve
curl -O https://raw.githubusercontent.com/ilianAZZ/issue-auto-solve/main/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs | grep 'dashboard on'
```

While the repository is private, the image is too: log in first with a token carrying
`read:packages`.

```bash
echo $GHCR_TOKEN | docker login ghcr.io -u <you> --password-stdin
```

Updating later is `docker compose -f docker-compose.prod.yml pull && … up -d`. No
configuration file is required: the image ships the defaults and the rest is done from the
dashboard. Mount `./config` only for the two settings a repository may not set for itself.

<details><summary>From a clone instead, to build locally</summary>

```bash
git clone https://github.com/<you>/issue-auto-solve && cd issue-auto-solve
cp .env.example .env
mkdir -p secrets state workspaces logs
docker compose up -d --build
docker compose logs | grep 'dashboard on'
```
</details>

That last line prints the dashboard URL with its token. Keep it.

**Do not open the port.** The dashboard is token-protected but has no TLS, and compose
binds it to `127.0.0.1` on purpose. Reach it from your laptop with a tunnel:

```bash
ssh -N -L 8420:localhost:8420 you@your-vps
```

Then open the URL from the log, with `localhost` in place of the host. Webhooks are not
reachable that way, which is fine: polling delivers everything they would have, a little
later. When you later put a reverse proxy with TLS in front, set `BIND=0.0.0.0` and
`PUBLIC_URL=https://…`, and the App will register a live webhook.

## 2. The setup screen

1. **GitHub** — *Create the GitHub App*. GitHub asks you to confirm, then sends you to the
   install screen: pick the repositories. The credentials come back on their own.
2. **Claude** — on a machine where you are logged in: `claude setup-token`, paste the
   result. Nothing is stored in clear text.
3. **Repositories** — add them. Leave `dispatch_enabled: false` for now.

Let one poll go by and read the dashboard: the split between *Queued*, *Needs approval*,
*Waiting on you* and *Skipped* is what the agent would actually do. If that split is
wrong, fix it before you let anything run.

## 3. The first real run — on something disposable

```yaml
# config/issue-auto-solve.yml
dispatch_enabled: true
max_concurrent_runs: 1
```

`docker compose restart`, and watch a throwaway repository with two trivial issues (see
[TESTING.md](TESTING.md) for the sandbox `.issue-auto-solve.yml`).

**Gate**: an issue reaches `pr_open`, the pull request is on the right base branch, and
the next tick does not open a second one. Do not go further until this holds.

## 4. This repository, worked on by itself

Add `.issue-auto-solve.yml` here:

```yaml
version: 1
base_branch: main
labels:
  exclude: [security]
  waiting: needs-human-input
selection:
  require_label: approved         # public repository: nothing runs unapproved
  trusted_associations: [OWNER, MEMBER, COLLABORATOR]
runtime:
  image: node:24-slim
  setup:
    - apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates gnupg
    - install -d -m 755 /etc/apt/keyrings && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && apt-get update && apt-get install -y --no-install-recommends gh
    - npm install -g @anthropic-ai/claude-code
preflight:
  - npm ci
checks:
  - name: types
    run: npm run typecheck
  - name: build
    run: npm run build
```

Then open the issues from [ROADMAP.md](../ROADMAP.md) step 4 and label the ones you want
picked up with `approved`.

**The one rule**: it must never redeploy itself. Merging its pull requests changes the
code on disk; the container keeps running the image it was built from until *you* run
`docker compose up -d --build`. Do that when no run is in flight — the dashboard says so.

## 5. Your other repositories

Two settings cannot come from the repository's own file, by design, so they go in
`config/issue-auto-solve.yml` on the host:

```yaml
allow_env: [ENVIRONMENT_PASSWORD]      # the only variables a repository may request

repositories:
  - repo: you/your-app
    enabled: true
    settings:
      runtime:
        docker_socket: true            # only for repositories you own: this is root on the host
```

Everything else — image, preflight, checks, labels, prompt — belongs in that repository's
`.issue-auto-solve.yml`, which the agent can write for you with **Generate config**.

Migrating a repository that already had a bot working its backlog: issues already carrying
the waiting label are adopted, not re-run. Check that in the dashboard before stopping the
old loop, and keep both stopped-side-by-side for a day rather than switching blind.

## 6. Day-to-day

To stop doing the `pull && up -d` step from [1. The host](#1-the-host) by hand, set
`auto_update.enabled: true` in `config/issue-auto-solve.yml` (or flip it in the dashboard's
**Updates** panel). It checks the published image on `check_interval_hours` and recreates
the container on a new one once nothing is running — the same volumes, so `state/` is
untouched. It only makes sense for the published-image deployment above; against a
`build: .` compose it just fails to pull and does nothing, since there is nothing to pull
from a registry.

```bash
docker compose logs -f --tail=100      # what the orchestrator is doing
docker compose restart                 # after editing config/issue-auto-solve.yml
docker compose up -d --build           # after pulling new code
docker compose exec issue-auto-solve ls /app/state
```

`state/` holds the database, the encryption key and the dashboard token: it is the only
directory worth backing up. `workspaces/` and `logs/` are disposable — and they grow
forever until the cleanup issue in the roadmap is done, so keep an eye on disk.
