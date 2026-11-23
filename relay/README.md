# ForgeClaw public relay

Lets visitors of the public ForgeClaw site use the hosted model (Qwen3-8B in `qwen3-8b.yml`)
**without your credentials and without anything from your own session**. It is a ~250-line
Cloudflare Worker (`worker.js`, free tier is enough). The model and research routes:

- `POST /v1/reason {task, context?}`: dispatch `qwen3-8b.yml` with NEXUS learning **off** and the
  browsable results mirror **off**. `context` carries gathered web evidence.
- `GET /v1/reason/<id>`: read that run's result from its artifact.
- `POST /v1/research {question}`: dispatch `deep-research.yml` (live web search and page reading,
  6 sources, mirror **off**), so visitors get current answers with citations.
- `GET /v1/research/<id>`: read that run's report from its artifact.
- `POST /v1/kalshi {method, url, headers, body}`: the owner's Kalshi transport fallback — forwards
  an already-signed Kalshi request verbatim to Kalshi (only the two `external-api` hosts) and
  returns its status and body, for when the browser cannot reach Kalshi directly. Nothing is
  stored or logged; the signing headers pass through untouched.
- **Family tier** (`/v1/family/repos/<owner>/<repo>/actions/...`, needs the `FAMILY_CODE`
  secret): the owner's family enters one simple code in ForgeClaw (Settings → GitHub → Family
  code) and gets the owner's interactive surface without holding any token. The app rewrites
  its GitHub Actions API calls to these routes; the relay performs them with its own token and
  returns GitHub's response verbatim. Only the interactive workflows in the worker's
  `FAMILY_WORKFLOWS` list can be dispatched or read back (chat, Nexus, images, research,
  search, browsing, shell, self-sculpt, voice transcription); trading workflows are never in the list, and nothing
  outside the Actions API exists on these routes. Limits: 300 dispatches per IP per hour
  (`FAMILY_MAX_PER_HOUR`) and 6 runs in progress per workflow (`FAMILY_MAX_CONCURRENT`).
  Rotate the code with `npx wrangler secret put FAMILY_CODE`; family browsers then need the
  new code once.
- **Nexus Isles seat orders** (`/seat-orders`, needs `FAMILY_CODE` and the separate
  `GITHUB_TOKEN_NEXUS` secret): the Nexus Isles resident view's orders box POSTs owner
  order entries here, and the relay appends them to the world's orders file
  (`DeviousDevv303/nexus-isles`, branch `live-world`, `world-data/seat-orders.json`),
  which the Isles runner reads fresh on every proposal. `GET /seat-orders?seat=<seat>`
  reads back what is recorded. Three separate guarantees, separately tested:
  - **HTTP authorization:** only a request carrying the family code reaches the write
    path; this route records `operator: "owner"` entries only. The browser never holds
    any GitHub token — the token below lives only in the worker.
  - **Deduplication:** an entry whose complete canonical identity (seat, tick, operator
    class, standing, directive, orders — compared by deterministic, key-sorted
    canonical JSON, against *every* entry in the seat's file) is already recorded
    appends nothing and answers `duplicate`. So: owner submits A → recorded; owner
    submits correction B → recorded; a network retry of stale A → no append; the
    engine resolves the tick from B. A different operator class carrying the same
    orders is *not* a duplicate and appends normally.
  - **Engine precedence:** the relay only records. What governs a tick is decided by
    the Isles runner from the file (owner class beats operator class regardless of
    append order; last entry wins within a class), and an order's lawfulness is the
    engine validator's verdict at resolution — relay responses say `recorded`, never
    `accepted`. The relay never creates the orders file and never touches world
    state, the journal, or any other repository content.
  Token for this route only: GitHub → Settings → Developer settings → Fine-grained
  tokens → **Only select repositories → nexus-isles**, **Contents: Read and write**,
  nothing else; then `npx wrangler secret put GITHUB_TOKEN_NEXUS` and redeploy. Until
  that secret is set, both seat-orders routes answer `503`.

The logging routes:

- `POST /v1/errors`: accepts a browser's error log. Secrets are stripped, the report is stored, and it is **emailed to you** via Resend when `RESEND_API_KEY` is set. (Note: the app's automatic send was removed 2026-10-21 — no current client posts this endpoint; the route stays live for manual or future use.)
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
  rate limiting is simply off. (With `RATE`, `/v1/kalshi` allows 120 calls an hour per IP.)
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
   **ERROR REPORTS** shows what users hit (the same reports arrive by email when Resend is
   configured). With the automatic browser send removed, this is empty unless reports are posted
   manually.

Friends and family need **nothing**: no account, no key, no setup. They open the link and type.

## Check it

- In a **private window** (no token there), open the site and ask something with the Qwen
  provider selected. You should see the yellow "Public mode" note, then an answer in a few minutes.
- In **your normal browser** (token present) nothing changes. The relay is never used there.
- `curl -i -X POST https://forgeclaw-relay.<you>.workers.dev/v1/reason -H 'Origin: https://evil.example'` must return `403`.

To turn public mode off, delete the `FORGECLAW_PUBLIC_RELAY_URL` variable and redeploy, or revoke the token.
