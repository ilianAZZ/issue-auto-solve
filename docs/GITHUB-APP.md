# Creating the GitHub App

The App is what gives the agent an identity of its own. With a personal token it writes
under *your* login, so "did a human reply to the agent's question?" has no reliable
answer — the two are the same account. The App also unlocks webhooks, which turn a reply
into an immediate resume instead of one at the next poll.

Ten minutes, once.

## 1. Create it

Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
(<https://github.com/settings/apps/new>; for an organisation, use its settings page
instead — the App then belongs to the org, not to you).

| Field | Value |
| --- | --- |
| **GitHub App name** | `issue-auto-solve` (must be unique across GitHub; add a suffix if taken). This name becomes the agent's login: `issue-auto-solve[bot]`. |
| **Homepage URL** | the repository URL, anything valid |
| **Webhook → Active** | on if you have a reachable URL, off otherwise — polling works without it |
| **Webhook URL** | `https://<your-host>/webhooks/github` |
| **Webhook secret** | generate one, keep it for `GITHUB_WEBHOOK_SECRET` |
| **Where can this be installed** | "Only on this account" |

**Repository permissions** — exactly these, nothing more:

| Permission | Access | Why |
| --- | --- | --- |
| Issues | Read and write | read the backlog, comment, label |
| Pull requests | Read and write | open the pull request |
| Contents | Read and write | clone, push the branch |
| Metadata | Read-only | mandatory, set automatically |

**Subscribe to events** (only if the webhook is on): `Issues`, `Issue comment`,
`Pull request`.

Click **Create GitHub App**.

## 2. Collect the credentials

On the App page:

- note the **App ID** at the top;
- **Generate a private key** at the bottom — a `.pem` downloads once and is never shown
  again.

```bash
mkdir -p secrets
mv ~/Downloads/issue-auto-solve.*.private-key.pem secrets/github-app.pem
chmod 600 secrets/github-app.pem
```

`secrets/` is gitignored. Never commit that file: it is the whole identity.

## 3. Install it on the repositories

App page → **Install App** → your account → **Only select repositories** → pick the ones
you want worked on. Installing is what grants access; listing a repository in
`config/issue-auto-solve.yml` without installing the App there fails with
`cannot watch <repo>`.

## 4. Point the orchestrator at it

```bash
# .env
GITHUB_AUTH_MODE=app
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_FILE=/secrets/github-app.pem   # ./secrets/github-app.pem outside Docker
GITHUB_WEBHOOK_SECRET=the-secret-you-generated
```

Start it. The log states the identity it will write under:

```
INFO [orchestrator] agent identity: issue-auto-solve[bot]
```

If it still prints your own login, it is still in token mode.

## 5. Webhooks without a public host

Polling is enough — webhooks only make reactions faster. To get them locally anyway:

```bash
gh extension install cli/gh-webhook
gh webhook forward --repo=<you>/<repo> --events=issues,issue_comment,pull_request \
  --url=http://localhost:8420/webhooks/github
```

Forwarded deliveries are not signed with your secret, so leave `GITHUB_WEBHOOK_SECRET`
empty while forwarding, and set it once the App posts to a real URL.

## What the App can reach

Worth being explicit, especially before making a repository public:

- an installation token, scoped to the installed repositories, valid one hour, handed to
  the run container as `GH_TOKEN`;
- the workspace of the issue being worked on, and nothing else;
- the host Docker socket, but only if that repository sets `runtime.docker_socket: true`
  — which is equivalent to root on the host. Enable it only for repositories you own.
