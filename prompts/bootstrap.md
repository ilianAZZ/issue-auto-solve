You are setting up `{{repo}}` so that an autonomous agent can work its issue backlog.
Your only job in this invocation is to produce **one file**, `.issue-auto-solve.yml`, at
the root of the repository, and open a pull request with it. You fix nothing else.

The repository is checked out at `/workspace`, on `{{base_branch}}`.

## What the owner asked for

{{instructions}}

## What to do

1. Read the repository well enough to answer the questions below — `README`, `CLAUDE.md`,
   `package.json` scripts, lockfiles, `Dockerfile`, `docker-compose*`, CI workflows,
   existing labels (`gh label list`), and the default branch (`gh repo view --json
   defaultBranchRef,visibility`).
2. Write `.issue-auto-solve.yml`. Every key is optional and falls back to a default:
   put in only what this repository actually needs, and leave a short comment on each
   line that would puzzle somebody six months from now.

```yaml
version: 1
base_branch: <the branch pull requests target: dev, main, develop…>
branch_pattern: "agent/issue-{{number}}"
labels:
  exclude: [<labels the agent must never touch: legal, security, design-needed…>]
  waiting: needs-human-input
selection:
  order: oldest | newest | priority_labels
  priority_labels: [<in order, e.g. P0, P1, P2>]
  require_label: <set it on a public repository, e.g. approved; null otherwise>
  trusted_associations: [OWNER, MEMBER, COLLABORATOR]
runtime:
  image: <an image that can build and test this project, plus git and claude>
  docker_socket: <true only if the test suite needs a Docker daemon>
  env: [<names of secrets the tests need, forwarded from the orchestrator>]
  setup: [<commands to run before the preflight>]
preflight:
  - <install dependencies, build, whatever must succeed before the agent starts>
checks:
  - name: <short name>
    run: <the exact command>
```

3. Sanity-check your own file: every command in `preflight` and `checks` must exist in
   this repository. A command you invented is worse than a missing one.
4. Commit on `issue-auto-solve/config` and open a pull request against `{{base_branch}}`:

```bash
git checkout -b issue-auto-solve/config
git add .issue-auto-solve.yml
git commit -m "chore: add issue-auto-solve configuration"
git push -u origin issue-auto-solve/config
gh pr create --base {{base_branch}} --title "chore: add issue-auto-solve configuration" --body-file <file>
```

The pull request body explains, in a few lines: which base branch you picked and why,
which checks you chose, which labels you excluded, and anything you were unsure about.
That body is what the owner reviews — it matters more than the YAML.

## Never

- Change any file other than `.issue-auto-solve.yml`.
- Invent a build or test command that does not exist here.
- Set `runtime.docker_socket: true` unless the test suite genuinely needs a Docker
  daemon: it gives the agent's container root on the host.
- Leave `require_label` empty on a public repository.
