# share

Self-destructing file and text sharing. Share text, images, audio or ZIP files (up to 500 MB; files over 100 MB last at most 15 minutes) through a link and QR code. Every share expires — 5 minutes by default, or 10 min, 15 min, 1 hour or 24 hours — and is refused by the server the instant it does. Accounts are optional: anyone can make a **Public** link without logging in. A **Private** link needs you logged in, and only your account can open it. On any other device it shows the "Private file !" screen and opens after a PIN that is emailed to your account address.

The UI is a 1:1 build of the Figma file `MDo67DCGsoi9ugHsKoOB3a` (8 frames, 402 × 874). See [Design](#design).

**Stack:** React + Vite + TypeScript · Node.js serverless functions on Vercel · MongoDB Atlas (M0 free) · Backblaze B2 · one GitHub repo, one Vercel project.

---

## How it works

```
Browser ──POST /api/shares──────────────▶ Vercel function ──▶ MongoDB (pending share)
        ◀── presigned PUT URL (15 min) ──┘
Browser ──PUT file (up to 500 MB; files over 100 MB last at most 15 minutes)───────▶ Backblaze B2 (never passes through Vercel)
Browser ──POST /api/shares/:id/complete─▶ Vercel function ──▶ R2 HEAD + read first 4 KB
                                          checks size + magic bytes, starts expiry clock
Viewer  ──GET /api/shares/:id───────────▶ Vercel function ──▶ checks expiry on every read
        ◀── presigned GET URL, valid ≤ min(remaining life, 5 min)
```

- **Expiry is enforced on every request**, independent of the cron. An expired share returns `410` and is purged on the spot: the R2 object is deleted and the record is stripped to a content-free tombstone (kept 24 h) so the link keeps saying "expired" or "deleted" instead of "not found". Deleting also removes every stored version in Backblaze B2 (a plain S3 delete would only hide the file there). Download links are presigned with a lifetime capped at the share's remaining seconds, so a link handed out at 4:59 stops working at 5:00.
- **Cleanup happens in three layers:** on access (above), opportunistically on every new share (sweeps up to 25 expired shares), by the cleanup endpoint, called daily by Vercel Cron and every 5 minutes by the GitHub Action in `.github/workflows/cleanup.yml` (add repo secrets `APP_URL` and `CRON_SECRET`) (`/api/cron/cleanup`, also removes orphaned R2 objects). A MongoDB TTL index and an R2 lifecycle rule are backstops.
- The expiry clock starts when the upload finishes, so slow uploads don't eat into the recipient's time. Unfinished uploads are discarded after 15 minutes.

## Security

| Concern | What the app does |
|---|---|
| Unguessable links | 128-bit random share IDs (`crypto.randomBytes`). Creator gets a separate 256-bit delete token, stored only as a SHA-256 hash. |
| File type spoofing | Extension allow-list before upload; after upload the server reads the first 4 KB from R2 and verifies the magic bytes (PNG, JPEG, GIF, WebP, AVIF, MP3, WAV, OGG, FLAC, M4A, AAC, WebM audio, ZIP). Anything else — HTML, SVG, PDFs, executables — is deleted. Files are served with the detected MIME type from R2's own domain, never from the app's origin. |
| Size abuse | `Content-Type` and `Content-Length` are signed into the presigned PUT, so R2 rejects any other size/type. The server re-checks the stored size before accepting. |
| Upload abuse | Per-IP rate limits (MongoDB-backed, shared across instances), a per-IP daily byte quota (default 1 GB), a global storage cap (default 8 GB, under R2's 10 GB free tier), and optional Cloudflare Turnstile. |
| Accounts | Passwords hashed with scrypt (N=2¹⁵, random salt). Sessions are HMAC-signed `HttpOnly`, `SameSite=Lax`, `Secure` cookies scoped to `/api`, valid 30 days. Login is rate limited per IP and per email, and unknown emails take as long as wrong passwords (no account enumeration). |
| Private shares | Locked to the owner account that created them. The owner's session, or the creating browser's 256-bit manage token, opens them directly. Anyone else must enter a 6-digit PIN, which is always emailed to the owner's account address. The client can't choose the recipient, and the address is never shown. PINs are hashed, expire in 5 minutes, allow 5 attempts, are single-use, have a 60-second resend cooldown and are capped at 6 per share per hour (so a leaked link can't flood your inbox). Success sets an `HttpOnly`, `SameSite=Lax`, `Secure` cookie scoped to `/api` and that one share, expiring with the share. Locked responses never include content or download URLs. |
| Data at rest | Text shares are encrypted with AES-256-GCM (bound to the share ID). IPs are stored only as keyed hashes. R2 bucket is private — no public access. |
| Secrets | All secrets are server-only env vars. Only `VITE_TURNSTILE_SITE_KEY` (public by design) reaches the browser. |
| Web hardening | Strict CSP, `X-Frame-Options: DENY`, HSTS, `no-referrer`, `no-store` on API responses, Origin check on state-changing requests, cron protected by `CRON_SECRET`. |

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/shares` | Create. Text: `{type:"text", text, ttlSeconds, visibility: "public"|"private"}`. File: `{type:"file", file:{name,size,mime}, …}` → returns `upload.url` to PUT to. |
| `POST` | `/api/shares/:id/complete` | Header `X-Manage-Token`. Validates the uploaded object and starts the timer. |
| `GET` | `/api/shares/:id` | View. Private shares return `{locked:true}` unless the caller is the owner (session), the creating browser (`X-Manage-Token`), or has entered the PIN. Includes `canDelete`. `404` unknown, `410` expired or deleted. |
| `DELETE` | `/api/shares/:id` | Creating browser (`X-Manage-Token`) or owner session. Deletes immediately. |
| `POST` | `/api/shares/:id/otp` | No body. Emails a PIN to the owner account. |
| `POST` | `/api/shares/:id/verify` | `{code}`: the PIN. Sets a per-share access cookie. |
| `POST` | `/api/auth/signup` | `{name, email, dob, password, confirmPassword}`. Creates the account and logs in. |
| `POST` | `/api/auth/login` | `{email, password}`. |
| `POST` | `/api/auth/logout` | Clears the session. |
| `GET` | `/api/auth/me` | `{user}` or `{user: null}`. |
| `GET` | `/api/cron/cleanup` | `Authorization: Bearer $CRON_SECRET`. |
| `GET` | `/api/health` | Database reachability. |

Errors are always `{ "error": { "code": "...", "message": "..." } }`.

## Project layout

```
api/                 Vercel functions (one file = one function; 8 total, Hobby allows 12)
  _lib/              Shared server code (underscore = not deployed as a function)
    db.ts            Mongoose schemas: Share, User, Otp, RateLimit (+ TTL indexes)
    auth.ts          scrypt passwords, signed session cookies, signup/login
    r2.ts            Presigned PUT/GET, HEAD, ranged read, batch delete
    signature.ts     Magic-byte detection
    shares.ts        Create / complete / view / delete / OTP / cleanup logic
    crypto.ts        IDs, HMAC, AES-GCM, access tokens
    rateLimit.ts     Fixed-window counters in MongoDB
    email.ts         Resend (HTTPS) or SMTP
shared/limits.ts     Limits, allowed types and API types used by both sides
src/
  design/            Figma canvas, primitives, menu, assets map
  assets/figma/      Original assets exported from Figma
  pages/             Create, Share (text/image/zip/audio/private/expired), Login, Sign up
scripts/dev-server.ts  Local API server mirroring vercel.json routing
tests/unit           Pure logic (signatures, crypto, validation, formatting)
tests/integration    Full HTTP flows against real MongoDB + S3-compatible storage
infra/r2-cors.json   CORS policy for the bucket
```

---

## Deployment (step by step)

You need free accounts on GitHub, Vercel, MongoDB Atlas and Cloudflare, plus an email sender (Resend or a Gmail app password).

### 1. Push to GitHub

```bash
git init && git add . && git commit -m "share"
git branch -M main
git remote add origin git@github.com:YOU/vanish.git
git push -u origin main
```

### 2. MongoDB Atlas (M0)

1. Create a **free M0 cluster**.
2. **Database Access** → add a user with *Read and write to any database* (or scoped to `vanish`).
3. **Network Access** → add `0.0.0.0/0`. Vercel functions don't have fixed IPs on the free plan; the strong password is the protection here.
4. **Connect → Drivers** → copy the URI and add the database name: `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/vanish?retryWrites=true&w=majority`.

### 3. Backblaze B2 (S3-compatible storage)

1. **Buckets → Create a Bucket**, e.g. `vanish-shares`. Keep **Files in Bucket are: Private**.
2. Note the bucket's **Endpoint** (e.g. `s3.us-west-004.backblazeb2.com`). Set `R2_ENDPOINT=https://<that endpoint>`; the signing region is read from it.
3. **CORS**: bucket → *CORS Rules* → share via the S3 API/`b2` CLI using `infra/b2-cors.json` (replace the origin with your Vercel URL and keep `http://localhost:5173` for local dev). Browser uploads fail without it.
4. **Lifecycle**: bucket → *Lifecycle Settings* → *Keep only the last version* (so deletes really free space). Normal cleanup is done by the app; this is only a backstop.
5. **App Keys → Add a New Application Key** → *Read and Write*, restricted to this bucket. Use the **keyID** as `R2_ACCESS_KEY_ID` and the **applicationKey** as `R2_SECRET_ACCESS_KEY` (shown once). `R2_BUCKET` is the bucket name.

The `R2_*` variable names are historical; any S3-compatible store works. For Cloudflare R2 instead, set `R2_ACCOUNT_ID` and omit `R2_ENDPOINT`.

### 4. Email for Private-file PINs

PINs go to the email address of the account that owns the private file. Pick a sender:

- **Gmail SMTP** (works for any recipient, no domain needed): enable 2-step verification, create an app password, then set `EMAIL_PROVIDER=smtp`, `SMTP_URL=smtps://you%40gmail.com:APPPASSWORD@smtp.gmail.com:465`, `EMAIL_FROM="share <you@gmail.com>"`.
- **Resend**: create an API key and verify a domain you own, then set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="share <pin@yourdomain.com>"`. Without a verified domain, Resend only delivers to your own Resend sign-up address. That's fine if you're the only account holder, but other users won't receive PINs.

Public shares, sign-up and login work without email. Only the PIN step needs it.

### 5. (Optional) Cloudflare Turnstile

Turnstile → add a site with your domain → copy the site key to `VITE_TURNSTILE_SITE_KEY` and the secret to `TURNSTILE_SECRET_KEY`. When the secret is set, every new share requires the widget.

### 6. Vercel

1. **Add New → Project** → import the GitHub repo. Framework preset **Vite** is detected; `vercel.json` sets the build command and output.
2. **Settings → Environment Variables** → add everything from `.env.example`:
   - `MONGODB_URI`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
   - `APP_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
   - `CRON_SECRET` — another random value (Vercel Cron sends it automatically as a Bearer token)
   - `APP_ORIGIN` — `https://your-project.vercel.app`
   - the email variables from step 4, Turnstile variables from step 5
3. **Deploy.**
4. Create the indexes once (TTL indexes included) from your machine:
   ```bash
   cp .env.example .env   # fill in MONGODB_URI (and APP_SECRET etc. — validation checks them)
   npm install
   npm run setup:db
   ```
   The daily cron also re-ensures indexes, so this is self-healing if you skip it.
5. Check `https://your-project.vercel.app/api/health` → `{"ok":true}`.
6. Update the R2 CORS origin if your final domain differs, and set `APP_ORIGIN` to match.

Every push to `main` redeploys; pull requests get preview deployments (their URLs are allowed by the Origin check automatically, but add them to R2 CORS if you want uploads to work on previews).

## Local development

```bash
npm install
cp .env.example .env      # fill in real Atlas + R2 values, add http://localhost:5173 to the B2 CORS rules
npm run setup:db
npm run dev               # web on http://localhost:5173, API on :3000 (proxied under /api)
```

Set `COOKIE_SECURE=false` locally if your browser refuses Secure cookies on `http://localhost` (Chrome and Firefox accept them).

## Tests

```bash
npm test                  # unit tests (no services needed)
npm run typecheck
```

Integration tests run real HTTP flows — direct uploads, signature rejection, expiry denial, OTP lockout, rate limits, byte quotas, cron cleanup, origin checks — against a real MongoDB and any S3-compatible server. They're skipped unless both are configured:

```bash
pip install "moto[server]" && moto_server -p 4566 &        # S3-compatible test server
docker run -d -p 27017:27017 mongo:7                         # or point at a test Atlas DB
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/vanish-test \
TEST_S3_ENDPOINT=http://127.0.0.1:4566 npm test
```

The included GitHub Actions workflow runs all of this on every push.

---

## Free-tier limitations (read before launch)

| Service | Free allowance | Impact on this app |
|---|---|---|
| **Vercel Hobby** | Non-commercial use only. Cron jobs run **at most once per day** with ±1 hour timing. 4.5 MB request body limit. 12 functions per deployment. | Daily cron is fine: expiry is enforced per request, and opportunistic sweeps clean up between runs. Files never go through Vercel, so the body limit doesn't apply. A commercial product needs Vercel Pro. |
| **Cloudflare R2** | 10 GB-month storage, 1M Class A (write/list) and 10M Class B (read) operations per month, free egress. | The 8 GB `STORAGE_CAP_BYTES` keeps you under 10 GB. Each file share costs ~2 Class A (PUT, delete) and ~3 Class B ops. Lifecycle rules work in whole days, which is why it's a backstop and not the main cleanup. |
| **MongoDB Atlas M0** | 512 MB storage, shared CPU, ~500 connections, ~100 ops/sec. | Records are tiny and short-lived. TTL monitor runs every ~60 s (backstop only). Heavy traffic would need a paid tier. |
| **Resend free** | 3,000 emails/month, 100/day. Without a verified domain it only emails your own sign-up address. | Use Gmail SMTP (~500/day) if other people will have accounts. |
| **Turnstile** | Free, unlimited. | — |

Other limits worth knowing:

- **Presigned URLs can't be revoked early.** A download URL is valid for at most `min(remaining lifetime, 5 min)`, so it always dies at expiry — but "Delete now" can leave an already-issued URL working until that moment (the object itself is deleted immediately, so in practice R2 then returns 404).
- **Long-lived shares:** preview URLs for audio/images last 5 minutes. If someone leaves an audio file paused longer than that on a 1-hour share, reload the page to resume. Downloads always fetch a fresh URL.
- **Private files on another device** open either by logging in there or by entering the PIN from your inbox.
- **IP-based limits** treat everyone behind one NAT (offices, campuses, mobile carriers) as one user.
- **Public links made while logged out** can be deleted early only from the browser that created them (the delete token lives in that browser). Logged-in owners can delete their links from any device.
- **No password reset yet.** Accounts have no "forgot password" flow because the design has none. Add one before inviting other users.

## Design

The UI reproduces the Figma file `MDo67DCGsoi9ugHsKoOB3a` one-to-one:

| Route | Figma frame |
|---|---|
| `/` | iPhone 17 - 1 (Create) |
| `/s/:id`, text | iPhone 17 - 2 |
| `/s/:id`, Zip | iPhone 17 - 3 |
| `/s/:id`, image | iPhone 17 - 4 |
| expired, deleted or unknown link | iPhone 17 - 5 |
| `/login` | iPhone 17 - 6 |
| `/signup` | iPhone 17 - 7 |
| `/s/:id`, private (not owner) | iPhone 17 - 8 |

How it's built:

- Every element sits at its exact Figma coordinates on a 402 × 874 canvas (`src/design`). Fonts are Alkalami (labels) and Inter Medium (drop-zone text), as in Figma. All images are the original Figma exports.
- Verified by rendering each route at 402 × 874 and diffing against Figma's own frame renders. Every element matches at offset 0 px.
- **Phones narrower than 402px** scale the whole canvas proportionally. **Wider screens** (tablet, laptop) show the canvas at 1:1, centred, with the cactus, sunflower and disco ball pinned to the window corners, because the file has no desktop frame.
- **Not in the design, added minimally in the same style:**
  - the menu's contents (Create Link, Login, Sign up / Log out)
  - one line of status/error text
  - an audio player (reusing the text layout)
  - upload progress inside the Create Link button
- **Behaviour choices:**
  - After creating, you land on the link's own page (frames 2/3/4). Share copies the link, or opens the phone's share sheet.
  - Delete appears only for whoever can delete: the creating browser or the owner account.
  - The Sign up button reads "Login", exactly as in the design.
  - There is no countdown, by request. The page switches to the expired screen the moment time runs out.
