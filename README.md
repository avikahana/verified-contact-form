# Verified Contact Form (Double Opt-In)

A production-grade contact form for static sites that **proves the sender owns
the email address they typed before any message is delivered** — classic
confirmed (double) opt-in. Nothing reaches the site owner until a single-use
magic link is clicked.

Built on **Firebase** (Hosting + Cloud Functions + Firestore) with the
*Trigger Email from Firestore* extension for delivery. No server to run, no
SMTP credentials in your code, and the public client can never be turned into
an open relay.

> This is a genericized, reusable template extracted from a live site. Replace
> the placeholder identifiers (project IDs, keys, owner email) with your own.

---

## Why

A naive "write the message straight to the database / email API from the
browser" form has two classic problems:

1. **Open relay / spam** — anyone can POST arbitrary payloads and use your form
   to send mail to anyone.
2. **Forged senders** — the "from" address is whatever the visitor typed; you
   can't trust it, and you can't reply with confidence.

This design fixes both: the browser can't write to the database at all
(Firestore rules deny it), every send is gated server-side, and the message is
only released **after the typed address confirms itself**.

---

## Flow at a glance

```
Browser (public/js/contact.js)
  │  POST /api/request-verification  {name,email,subject,message,_hp, X-Firebase-AppCheck}
  ▼
requestVerification (Cloud Function)
  1. origin check  2. App Check verify  3. honeypot (_hp)  4. validate  5. rate-limit (IP+email)
  6. create pending_messages/{id}  {status:pending, tokenHash(SHA-256), expiresAt:+15m}
  7. queue VERIFY email → messages  (to = submitter, magic link /verify.html?id=&token=)
  └─ returns {pendingId}
  │
  ▼  page shows "Check your email" popup, polls GET /api/status?id= every 3s
  │
Submitter clicks magic link → /verify.html
  │  POST /api/verify {id, token}   (POST-on-load: a scanner that GETs the link can't burn the token)
  ▼
verify (Cloud Function)
  txn: token matches (constant-time) + not expired + not consumed → status=consumed (single-use)
  only THEN queue OWNER email → messages  (to = OWNER_EMAIL, replyTo = submitter)
  └─ returns {status: verified|already|expired|invalid}
  │
  ▼  verify.html redirects to /?sent=1#contact → homepage shows the success banner
```

The **Trigger Email from Firestore** extension watches the `messages`
collection and actually sends both emails over your SMTP provider.

---

## Security layers

1. **Double opt-in** — message withheld until the typed address confirms via a
   single-use, 15-minute, SHA-256-hashed token (constant-time compare). The
   token plaintext is **never stored** — it lives only in the emailed link.
2. **App Check (reCAPTCHA v3)** — start in monitor mode, flip to enforcing;
   no/invalid token → **401**.
3. **Rate limiting** — fixed-window counters, 5/IP + 3/email per 60 min → **429**.
4. **Honeypot** — a hidden `company` field; if filled, the server fakes success
   and drops the request so bots don't learn they were caught.
5. **Firestore rules** — clients can read/write **none** of the three
   collections; everything goes through the Admin SDK in functions.
6. **Origin check** — cross-origin callers are rejected (same-origin calls via
   Hosting rewrites send no Origin header and are allowed).

---

## Project structure

```
.
├── firebase.json            Hosting rewrites (/api/* → functions) + functions + firestore
├── firestore.rules          Locks all three collections to server-only
├── .firebaserc              Your Firebase project id (placeholder: your-project)
├── functions/
│   ├── index.js             requestVerification / verify / status handlers
│   ├── config.js            All tunables (env-overridable)
│   ├── util.js              Email + token + App Check + rate-limit + helpers
│   ├── email.js             buildVerifyEmail / buildOwnerEmail (Trigger-Email doc shape)
│   ├── .env.example         Copy to .env / .env.<project> and fill in
│   ├── package.json
│   └── test-e2e.mjs         24 integration tests vs an in-memory Firestore fake
└── public/
    ├── index.html           Demo page with the contact form + verify popup
    ├── verify.html          Magic-link landing (POST-on-load to /api/verify)
    ├── css/contact.css      Self-contained styles (form, honeypot, popup)
    └── js/contact.js        Form handler: App Check, POST, poll status, success banner
```

### Data model (Firestore)

- **`pending_messages/{id}`** (server-only): `name, email, subject, body,
  tokenHash (SHA-256 hex), status (pending|consumed), ip, createdAt, expiresAt,
  consumedAt`.
- **`messages/{id}`** (server-only): the Trigger-Email outbox — `to, replyTo?,
  message{subject,text,html}`. The extension stamps back `delivery{state,error}`.
- **`rate_limits/{key}`** (server-only): fixed-window counters keyed `ip:<ip>` /
  `email:<addr>` — `count, windowStart, expiresAt`.

---

## Setup

**Prerequisites:** a Firebase project on the **Blaze** plan (Cloud Functions
require it), the Firebase CLI (`npm i -g firebase-tools`), and Node 22.

1. **Create / select a project**
   - Put its id in `.firebaserc` (replace `your-project`).
   - In `public/js/contact.js`, paste your Firebase **web config** (Project
     settings → your web app).

2. **Install the Trigger Email extension**
   - Firebase console → Extensions → *Trigger Email from Firestore*.
   - Point it at the `messages` collection.
   - Configure SMTP (e.g. a Gmail account with an **App Password** — 2FA
     required). The SMTP password lives only in the extension's secret, never in
     this repo.

3. **App Check (reCAPTCHA v3)**
   - Create a reCAPTCHA v3 key; add your domain(s).
   - Paste the **site key** into `RECAPTCHA_V3_SITE_KEY` in `contact.js`.
   - Register the matching **secret** in Firebase console → App Check.
   - Keep `APP_CHECK_ENFORCE=false` (monitor) until metrics look clean, then
     flip to `true`.

4. **Configure functions**
   - `cp functions/.env.example functions/.env` (or `.env.<project-id>`),
     set `OWNER_EMAIL`, `SITE_ORIGIN`, `SITE_NAME`, `ALLOWED_ORIGINS`.

5. **Firestore TTL (recommended)**
   - Add a TTL policy on `pending_messages.expiresAt` and
     `rate_limits.expiresAt` so expired docs are reaped automatically.

6. **Deploy**
   ```bash
   cd functions && npm install && cd ..
   firebase deploy
   ```

---

## Local testing

```bash
cd functions
npm install
npm test          # node test-e2e.mjs — 24 cases against an in-memory Firestore fake
```

The test drives the **real** handlers (happy path, wrong/expired/reused token,
honeypot, rate limits, validation, method guards) without needing the emulator
or a JRE. App Check / reCAPTCHA is domain-locked, so end-to-end verification of
the live tokens happens against the deployed site.

---

## Configuration reference (`functions/config.js`, env-overridable)

| Constant | Default | Notes |
|---|---|---|
| `REGION` | `us-central1` | Must match the Trigger Email extension region. |
| `SITE_ORIGIN` | `https://example.com` | Used to build magic links + lock callers. |
| `SITE_NAME` | `Example Site` | Shown in the emails. |
| `OWNER_EMAIL` | `owner@example.com` | Verified messages are delivered here. |
| `TOKEN_TTL_MINUTES` | `15` | Magic-link lifetime. |
| `RATE_LIMIT_WINDOW_MINUTES` | `60` | Fixed window. |
| `RATE_LIMIT_MAX_PER_IP` | `5` | |
| `RATE_LIMIT_MAX_PER_EMAIL` | `3` | |
| `APP_CHECK_ENFORCE` | `false` | `true` = reject missing/invalid App Check tokens. |

### Debugging by HTTP status

| Status | Meaning |
|---|---|
| **401** | App Check rejected (no/invalid token). |
| **429** | Rate limited (App Check passed). |
| **400** | Bad/missing fields, or invalid email. |
| **403** | Origin not allowed. |

For delivery problems, read the `delivery` field the extension stamps onto the
newest `messages` doc (`SUCCESS` / `ERROR` + `delivery.error`).

---

## License

[MIT](LICENSE) © 2026 Avi Kahana
