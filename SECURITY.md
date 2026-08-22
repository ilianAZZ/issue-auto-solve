# Security model

issue-auto-solve runs an autonomous agent with write access to your repositories, on your
machine. This is what it can reach, what stops it, and what is not protected.

## What the agent can reach during a run

- **A GitHub token** for the repositories it works on, injected as `GH_TOKEN`. With a
  GitHub App this is an installation token, scoped to the installed repositories and valid
  one hour. With a personal token, it is yours, with your scopes — one more reason to
  prefer the App.
- **One workspace**, the clone of the issue it is working on, deleted after the run.
- **The Docker socket**, but only if the operator enabled it for that repository. That is
  equivalent to root on the host, so it is off by default and cannot be turned on from the
  repository being worked on.
- **Nothing else from the host**: the orchestrator's own environment is not passed through.
  A repository can request environment variables in `runtime.env`, but only names the
  operator listed in `allow_env` are forwarded.

## The dashboard is authenticated

It can add repositories, replace credentials and read run logs, so it is never open. A
token is generated on first boot in `state/dashboard.token` (mode 600) and printed once at
startup; set `DASHBOARD_TOKEN` to pin your own. Everything but the static page and the
signature-checked webhook requires it, and comparison is constant-time.

It has no TLS of its own. Put it behind a reverse proxy or a VPN before exposing it.

## The repository file is untrusted input

`.issue-auto-solve.yml` lives in the repository being worked on, which means anyone who can
land a commit there — including the agent itself, through a pull request — controls it.
Two settings are therefore resolved from the operator's configuration only and silently
overridden if the file tries to widen them:

| Setting | Why |
| --- | --- |
| `runtime.docker_socket` | mounting the socket is root on the host |
| `runtime.env` | otherwise a repository could ask for any variable in the orchestrator's environment |

Everything else — image, preflight, checks, prompt — is deliberately repository-controlled:
that is the point of the tool, and it all executes inside the container.

## Public repositories

Anybody can open an issue, and an issue body is text an agent will read and act on. Set an
approval gate:

```yaml
selection:
  require_label: approved
  trusted_associations: [OWNER, MEMBER, COLLABORATOR]
```

Unapproved issues sit in `needs_approval`: never claimed, never read. Adding a label
already requires triage permission on GitHub, so the label is the gate.

## Secrets at rest and in logs

- Credentials entered in the dashboard are encrypted (AES-256-GCM) in SQLite under a key
  generated on first boot in `state/master.key` (mode 600). This protects against a glance
  at the database, not against someone who already has the disk.
- Run logs are scrubbed as they are written: the GitHub token and the Claude token are
  replaced with `[redacted]`, including when they straddle two writes. Worth knowing,
  because the clone's remote URL carries the token and `git remote -v` is a normal thing
  for an agent to run.
- The private key of the GitHub App belongs in `secrets/`, which is gitignored along with
  `*.pem` and every `.env` but the example.

## What is not protected

- **The agent is not sandboxed beyond the container.** It runs with network access and can
  reach anything the image can reach.
- **`docker_socket: true` is root on the host.** Enable it only for repositories you own,
  and never on a shared machine.
- **`state/master.key` sits next to the database it protects.** Anyone with filesystem
  access has both.
- **No TLS, no multi-user, no audit trail of who did what** in the dashboard: it assumes a
  single operator.

## Reporting

Open a private security advisory on the repository rather than a public issue.
