# Give ForgeClaw its own GitHub identity (name + avatar)

Today ForgeClaw's pull requests are opened by `github-actions[bot]` (GitHub's own icon), and GitHub does not run the
normal build check on them. With a GitHub App named ForgeClaw, they come from **forgeclaw[bot]** with the ForgeClaw
emblem, commits carry the same identity, and the pull requests get the normal checks.

The workflows (`shell-repair.yml`, `self-sculpt.yml`) already support it. Until the steps below are done they keep using
the default token, so nothing breaks in the meantime.

## One-time setup (about 5 minutes, you do this: only the repository owner can)

1. GitHub → your profile → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. **Name:** `ForgeClaw` (if it is taken, use `ForgeClaw Agent`; GitHub turns the name into a slug, e.g. `forgeclaw-agent`).
3. **Homepage URL:** `https://deviousdevv303.github.io/forgeclaw/`
4. **Webhook:** untick *Active* (not needed).
5. **Repository permissions** (nothing else): **Contents: Read and write**, **Pull requests: Read and write**. Leave
   *Workflows* off: that keeps the app unable to change workflow files.
6. **Where can this app be installed:** *Only on this account*. Click **Create GitHub App**.
7. On the app page: **Display information → upload** `docs/brand/forgeclaw-avatar.png` (the emblem). Note the **App ID** at the top.
8. **Generate a private key** (a `.pem` file downloads).
9. **Install App** (left menu) → your account → **Only select repositories → forgeclaw**.
10. In the repository: **Settings → Secrets and variables → Actions**
    - Variables tab → **New repository variable:** `FORGECLAW_APP_ID` = the App ID. If the slug is not `forgeclaw`, also
      `FORGECLAW_APP_SLUG` = the slug.
    - Secrets tab → **New repository secret:** `FORGECLAW_APP_PRIVATE_KEY` = the whole contents of the `.pem` file.
11. Delete the downloaded `.pem` from your phone/computer once it is saved as the secret.

## Check it worked
Run a small `shell_patch` or `/sculpt` request. The pull request should be authored by **forgeclaw[bot]**, titled
`[ForgeClaw] …`, show the emblem at the top of its description, and have the **build** check running.

## Safety notes
- The app token is created only after the patch has been built and verified, so patched code never runs with it.
- The app can only touch this repository (contents and pull requests). It cannot edit workflow files, merge, or read secrets.
- Nothing is merged automatically; every proposal still needs your merge.
- To switch it off: remove the `FORGECLAW_APP_ID` variable. The workflows fall back to the default token.
