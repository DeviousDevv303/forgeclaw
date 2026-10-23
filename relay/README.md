# ForgeClaw public relay

Lets visitors of the public ForgeClaw site use the hosted model (Qwen3-8B in `deepseek-16b.yml`)
**without your credentials and without anything from your own session**. It is a ~250-line
Cloudflare Worker (`worker.js`, free tier is enough). The model and research routes:

- `POST /v1/reason {task, context?}`: dispatch `deepseek-16b.yml` with NEXUS learning **off** and the
  browsable results mirror **off**. `context` carries gathered web evidence.
- `GET /v1/reason/<id>`: read that run's result from its artifact.
- `POST /v1/research {question}`: dispatch `deep-research.yml` (live web search and page reading,
  6 sources, mirror **off**), so visitors get current answers with citations.
- `GET /v1/research/<id>`: read that run's report from its artifact.
- `POST /v1/kalshi {method, url, headers, body}`: the owner's Kalshi transport fallback — forwards
  an already-signed Kalshi request verbatim to Kalshi (only the two `external-api` hosts) and
  returns its status and body, for when the browser cannot reach Kalshi directly. Nothing is
  stored or logged; the signing headers pass through untouched.

The logging routes:

- `POST /v1/errors`: every ForgeClaw user's browser (yours too) sends its error log here
  automatically. Secrets are stripped, the report is stored, and it is **emailed to you** via Resend.
- `GET /v1/learning` and `GET /v1/errors` (owner only, needs `OWNER_KEY`): export the stored visitor
  conversations (import them into NEXUS from the NEXUS tab) and error reports.

It cannot write to the repository or run any other workflow or tool. Visitors never see your session:
your keys, tools, NEXUS and chats live only in your browser.

**Limits** (all set in `wrangler.toml`):
- **Allowed origins:** only the sites listed in `ALLOWED_ORIGINS` can call it.
- **Size:** task 4,000 characters, context 16,000, research question 500.
- **Per-IP:** 10 model runs and 10 research runs an hour (`MAX_PER_HOUR`, counted separately). This needs the `RATE` KV namespace.
- **Concurrency:** 3 public runs at once per workflow (`MAX_CONCURRENT`), so your own runs are never starved.

**Privacy notice shown to visitors:** prompts run in your public repository's Actions, and run
artifacts on a public repository can be downloaded by signed-in GitHub users. The app tells
visitors not to enter private information.

**Visitor learning, built so it can't be steered:**
- **Who writes records:** only the relay, from the run's own result (answer or research outcome). A visitor can't submit or edit one.
- **Signing:** each record is signed with `OWNER_KEY`. The NEXUS import drops anything whose signature doesn't verify, so nothing altered or forged gets in. Without `OWNER_KEY`, nothing is recorded.
- **Anonymity and caps:** each visitor gets an anonymous id (an HMAC of their IP; the IP itself is never stored). They're capped at 20 records a day, and the same question in a day is kept once.
- **Flags:** text that reads like instructions to a model is flagged (`instruction-like`, `many-links`, `encoded-blob`) and shown with ⚠ on the NEXUS page.
- **In NEXUS:** imported records stay **unapproved**. One visitor counts once, however many runs they send. Visitor records **never reach a model's prompt**: prompts use only the owner's own runs and records the owner approved.

## Kalshi-only deploy (just the transport fallback)

If all you want is the Kalshi fallback — your browser cannot reach Kalshi directly (CORS, or
the signed headers blocked at preflight) and you don't need public visitor mode — the relay
needs **no GitHub token and no secrets**. The `/v1/kalshi` route works on its own:

```bash
cd relay
npx wrangler@4 login
npx wrangler@4 kv namespace create RATE   # paste the printed id into wrangler.toml, uncommenting the RATE block
npx wrangler@4 deploy                     # prints https://forgeclaw-relay.<you>.workers.dev
```

Then paste the workers.dev URL into ForgeClaw: **Settings → Kalshi trading → Kalshi relay
URL**. From then on, Kalshi calls the browser cannot make directly — market reads and the
signed order path alike — go through the relay instead.

**Do not set the `FORGECLAW_PUBLIC_RELAY_URL` repo variable for Kalshi.** It is the public-visitor
switch: with it set, every browser that has no GitHub token (including yours, if you never saved
one there) is treated as a visitor, the Kalshi Settings section disappears, and any key already
saved is ignored. The Settings field above is the Kalshi route and needs no variable and no token.

Two honest limits of the minimal deploy:

- **Without the `RATE` namespace the relay has no per-IP limit, only the origin check.**
  Every route refuses callers whose `Origin` is not in `ALLOWED_ORIGINS` (wrangler.toml);
  that check always applies, token or no token. The per-IP quotas are the only other brake,
  and they do nothing until `RATE` exists — skip the `kv namespace create RATE` step and
  rate limiting is simply off. (With `RATE`, `/v1/kalshi` allows 120 calls an hour per IP. If the quota store itself errors, for example a Workers KV daily write limit on the free plan, Kalshi calls go through without a limit rather than failing; the model routes still fail closed.)
- The model and research routes answer `503` until `GITHUB_TOKEN` is set, and visitor
  learning and error reports stay off until `LEARN` and `OWNER_KEY` exist. The full deploy
  below turns everything on.

## Deploy (about 10 minutes, one time)

1. **Create the token.** GitHub → Settings → Developer settings → Fine-grained tokens → Generate:
   - Repository access: **Only select repositories → forgeclaw**
   - Permissions: **Actions: Read and write**. Nothing else (Metadata: read is automatic).
   - Expiration: your choice; put a reminder to rotate it.
2. **Deploy the worker** (needs a free Cloudflare account):
   ```bash
   cd relay
   npx wrangler@4 login
   npx wrangler@4 kv namespace create RATE      # paste the printed id into wrangler.toml, uncomment the block
   npx wrangler@4 kv namespace create LEARN     # same: paste the id into the LEARN block
   npx wrangler@4 secret put GITHUB_TOKEN       # paste the token from step 1
   npx wrangler@4 secret put OWNER_KEY          # any long phrase only you know (for NEXUS import)
   npx wrangler@4 secret put RESEND_API_KEY     # free key from https://resend.com (sign up with your email)
   npx wrangler@4 secret put REPORT_EMAIL       # the email you signed up to Resend with
   npx wrangler@4 deploy                        # prints https://forgeclaw-relay.<you>.workers.dev
   ```
   If your site is served from a custom `.io` domain, add it to `ALLOWED_ORIGINS` (comma-separated)
   before `deploy`, e.g. `https://deviousdevv303.github.io,https://forgeclaw.io`.
3. **Point the site at it.** GitHub → forgeclaw → Settings → Secrets and variables → Actions →
   **Variables** → New variable `FORGECLAW_PUBLIC_RELAY_URL` = the workers.dev URL from step 2.
4. **Redeploy the site.** Actions → *Deploy to GitHub Pages* → Run workflow (or push to main).

5. **In your ForgeClaw (owner browser):** NEXUS tab → *Visitors · learning & error reports* → paste the
   same `OWNER_KEY` → **IMPORT TO NEXUS** pulls visitor conversations in as unapproved candidates;
   **ERROR REPORTS** shows what every user hit (the same reports arrive by email).

Friends and family need **nothing**: no account, no key, no setup. They open the link and type.

## Check it

- In a **private window** (no token there), open the site and ask something with the DeepSeek
  provider selected. You should see the yellow "Public mode" note, then an answer in a few minutes.
- In **your normal browser** (token present) nothing changes. The relay is never used there.
- `curl -i -X POST https://forgeclaw-relay.<you>.workers.dev/v1/reason -H 'Origin: https://evil.example'` must return `403`.

To turn public mode off, delete the `FORGECLAW_PUBLIC_RELAY_URL` variable and redeploy, or revoke the token.
