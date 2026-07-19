<h1 align="center">Verified Contact Form</h1>

<p align="center">
  <strong>Double opt-in contact flow for static websites.</strong>
</p>

<p align="center">
  <kbd>Firebase</kbd>
  <kbd>double opt-in</kbd>
  <kbd>hashed tokens</kbd>
  <kbd>App Check</kbd>
  <kbd>server-only Firestore</kbd>
  <kbd>MIT</kbd>
</p>

<p align="center">
  Verified Contact Form is a reusable Firebase contact form template that proves
  the sender owns the email address they typed before any message is delivered.
  The browser never writes directly to Firestore, never chooses the final email
  recipient, and cannot turn the form into an open relay.
</p>

<h2 align="center">Reading Map</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Start Here</th>
      <th>Then Check</th>
      <th>Deep Dive</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="#quick-start">Quick Start</a></td>
      <td><a href="#flow-at-a-glance">Flow At A Glance</a></td>
      <td><a href="#configuration-reference">Configuration Reference</a></td>
    </tr>
    <tr>
      <td><a href="#what-it-does">What It Does</a></td>
      <td><a href="#security-model">Security Model</a></td>
      <td><a href="#debugging-by-http-status">Debugging By HTTP Status</a></td>
    </tr>
    <tr>
      <td><a href="#why-it-exists">Why It Exists</a></td>
      <td><a href="#project-structure">Project Structure</a></td>
      <td><a href="#local-testing">Local Testing</a></td>
    </tr>
  </tbody>
</table>

</div>

<div align="center">

<table>
  <tbody>
    <tr><th>Frontend</th><td>Static HTML, CSS, and browser JavaScript</td></tr>
    <tr><th>Backend</th><td>Firebase Cloud Functions</td></tr>
    <tr><th>Database</th><td>Firestore, server-only access</td></tr>
    <tr><th>Email delivery</th><td>Trigger Email from Firestore extension</td></tr>
    <tr><th>Verification</th><td>Single-use magic link with SHA-256 token hash</td></tr>
    <tr><th>Default token lifetime</th><td>15 minutes</td></tr>
    <tr><th>Default rate limits</th><td>5 per IP and 3 per email per 60 minutes</td></tr>
    <tr><th>License</th><td>MIT</td></tr>
  </tbody>
</table>

</div>

<h2 align="center">Why It Exists</h2>

<p align="center">
  A naive contact form sends whatever the browser submits directly to a database
  or email API. That creates two problems: the form can become an open relay,
  and the claimed sender address may be forged. This template holds the message
  until the typed email address confirms itself.
</p>

<p align="center">
  It is a genericized template extracted from a live site. Replace placeholder
  project IDs, keys, names, and owner email settings with your own Firebase and
  domain configuration.
</p>

> [!NOTE]
> Nothing reaches the site owner until the submitter clicks the verification
> link. The owner receives a message only after the token is consumed by the
> backend.

<h2 align="center">What It Does</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Workflow</th>
      <th>File Or Layer</th>
      <th>What You Get</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Collect message</td>
      <td><code>public/index.html</code>, <code>public/js/contact.js</code></td>
      <td>Static contact form with App Check support, popup state, and status polling</td>
    </tr>
    <tr>
      <td>Request verification</td>
      <td><code>requestVerification</code></td>
      <td>Server-side validation, honeypot, rate limit checks, and pending message creation</td>
    </tr>
    <tr>
      <td>Email the submitter</td>
      <td><code>buildVerifyEmail()</code></td>
      <td>Magic link sent through the Trigger Email extension</td>
    </tr>
    <tr>
      <td>Consume token</td>
      <td><code>verify</code></td>
      <td>Constant-time token check, expiry check, single-use transaction, and owner email release</td>
    </tr>
    <tr>
      <td>Poll status</td>
      <td><code>status</code></td>
      <td>Pending, verified, or expired state for the browser popup</td>
    </tr>
    <tr>
      <td>Lock data</td>
      <td><code>firestore.rules</code></td>
      <td>Client reads and writes denied for all contact-form collections</td>
    </tr>
  </tbody>
</table>

</div>

<h2 align="center">Quick Start</h2>

<p align="center"><strong>Prerequisites:</strong> Firebase Blaze plan, Firebase CLI, Node 22, and an SMTP provider for the Firebase email extension.</p>

<p align="center"><strong>1. Configure the Firebase project</strong></p>

- Put your Firebase project id in `.firebaserc`.
- In `public/js/contact.js`, paste your Firebase web config from Project settings.

<p align="center"><strong>2. Install the Trigger Email extension</strong></p>

- Firebase console -> Extensions -> Trigger Email from Firestore.
- Point it at the `messages` collection.
- Configure SMTP, for example Gmail with an App Password and 2FA enabled.
- Keep SMTP credentials in the extension secret, not in this repo.

<p align="center"><strong>3. Set up App Check</strong></p>

- Create a reCAPTCHA v3 key and add your domain.
- Put the site key in `RECAPTCHA_V3_SITE_KEY` in `public/js/contact.js`.
- Register the matching secret in Firebase console -> App Check.
- Keep `APP_CHECK_ENFORCE=false` until monitor-mode metrics look clean.

<p align="center"><strong>4. Configure functions</strong></p>

```bash
cp functions/.env.example functions/.env
```

Set `OWNER_EMAIL`, `SITE_ORIGIN`, `SITE_NAME`, and `ALLOWED_ORIGINS`.

<p align="center"><strong>5. Add Firestore TTL policies</strong></p>

Add TTL policies on:

- `pending_messages.expiresAt`
- `rate_limits.expiresAt`

<p align="center"><strong>6. Deploy</strong></p>

```bash
cd functions
npm install
cd ..
firebase deploy
```

<h2 align="center">Flow At A Glance</h2>

```text
Browser contact form
  POST /api/request-verification
      |
      v
requestVerification
  1. Origin check
  2. App Check
  3. Honeypot
  4. Field validation
  5. IP and email rate limits
  6. Create pending_messages/{id}
  7. Queue submitter verification email
      |
      v
Submitter clicks /verify.html?id=...&token=...
      |
      v
verify
  1. POST token to backend
  2. Match SHA-256 hash in constant time
  3. Reject expired, invalid, or already consumed tokens
  4. Mark pending message consumed in a transaction
  5. Queue owner email with replyTo = submitter
      |
      v
Homepage shows sent confirmation
```

`verify.html` performs a POST on load. Link scanners that only GET the magic
link cannot consume the token.

<h2 align="center">Security Model</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Layer</th>
      <th>Default Posture</th>
      <th>Why It Matters</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Double opt-in</td><td>Message withheld until sender clicks a single-use link</td><td>Forged sender addresses do not reach the owner</td></tr>
    <tr><td>Token storage</td><td>Only SHA-256 token hash is stored</td><td>Plaintext token lives only in the email link</td></tr>
    <tr><td>Token compare</td><td>Constant-time comparison</td><td>Reduces timing leaks during verification</td></tr>
    <tr><td>App Check</td><td>Monitor first, then enforce</td><td>Blocks missing or invalid browser attestation when enabled</td></tr>
    <tr><td>Rate limiting</td><td>Fixed-window counters by IP and email</td><td>Limits abuse before messages enter the queue</td></tr>
    <tr><td>Honeypot</td><td>Hidden field returns fake success when filled</td><td>Bots are dropped without learning the trap</td></tr>
    <tr><td>Firestore rules</td><td>Client access denied for all collections</td><td>All reads and writes go through Admin SDK functions</td></tr>
    <tr><td>Origin check</td><td>Cross-origin callers rejected</td><td>Reduces off-site reuse of the public endpoint</td></tr>
  </tbody>
</table>

</div>

> [!IMPORTANT]
> The public client never decides who receives the final message. The owner
> email is built server-side only after verification succeeds.

<h2 align="center">Project Structure</h2>

```text
.
├── firebase.json            Hosting rewrites, functions, and Firestore config
├── firestore.rules          Denies client access to contact-form collections
├── .firebaserc              Firebase project id placeholder
├── functions/
│   ├── index.js             requestVerification, verify, and status handlers
│   ├── config.js            Region, site, TTL, rate limit, and App Check settings
│   ├── util.js              Email validation, token, App Check, rate-limit helpers
│   ├── email.js             Trigger Email document builders
│   ├── .env.example         Local config template
│   ├── package.json
│   └── test-e2e.mjs         Integration tests with in-memory Firestore fake
└── public/
    ├── index.html           Demo page with the contact form
    ├── verify.html          Magic-link landing page
    ├── css/contact.css      Form, honeypot, popup, and banner styles
    └── js/contact.js        Submit, App Check, polling, and success banner logic
```

<h2 align="center">Data Model</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Collection</th>
      <th>Access</th>
      <th>Purpose</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>pending_messages/{id}</code></td><td>server-only</td><td>Message draft, sender details, token hash, status, IP, timestamps, expiry</td></tr>
    <tr><td><code>messages/{id}</code></td><td>server-only</td><td>Trigger Email outbox for verification and owner emails</td></tr>
    <tr><td><code>rate_limits/{key}</code></td><td>server-only</td><td>Fixed-window counters keyed by <code>ip:&lt;ip&gt;</code> and <code>email:&lt;addr&gt;</code></td></tr>
  </tbody>
</table>

</div>

<h2 align="center">Local Testing</h2>

```bash
cd functions
npm install
npm test
```

The test suite drives the real handlers against an in-memory Firestore fake. It
covers happy path, wrong token, expired token, reused token, honeypot, rate
limits, validation, and method guards. App Check and reCAPTCHA are domain-bound,
so live token verification is tested against the deployed site.

<h2 align="center">Configuration Reference</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Constant</th>
      <th>Default</th>
      <th>Notes</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>REGION</code></td><td><code>us-central1</code></td><td>Must match the Trigger Email extension region</td></tr>
    <tr><td><code>SITE_ORIGIN</code></td><td><code>https://example.com</code></td><td>Used for magic links and caller checks</td></tr>
    <tr><td><code>SITE_NAME</code></td><td><code>Example Site</code></td><td>Shown in email copy</td></tr>
    <tr><td><code>OWNER_EMAIL</code></td><td><code>owner@example.com</code></td><td>Verified messages are delivered here</td></tr>
    <tr><td><code>TOKEN_TTL_MINUTES</code></td><td><code>15</code></td><td>Magic-link lifetime</td></tr>
    <tr><td><code>RATE_LIMIT_WINDOW_MINUTES</code></td><td><code>60</code></td><td>Fixed rate-limit window</td></tr>
    <tr><td><code>RATE_LIMIT_MAX_PER_IP</code></td><td><code>5</code></td><td>Requests per IP per window</td></tr>
    <tr><td><code>RATE_LIMIT_MAX_PER_EMAIL</code></td><td><code>3</code></td><td>Requests per email per window</td></tr>
    <tr><td><code>APP_CHECK_ENFORCE</code></td><td><code>false</code></td><td><code>true</code> rejects missing or invalid App Check tokens</td></tr>
  </tbody>
</table>

</div>

<h2 align="center">Debugging By HTTP Status</h2>

<div align="center">

<table>
  <thead>
    <tr>
      <th>Status</th>
      <th>Meaning</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><code>401</code></td><td>App Check rejected a missing or invalid token</td></tr>
    <tr><td><code>429</code></td><td>Rate limited after App Check passed</td></tr>
    <tr><td><code>400</code></td><td>Bad or missing fields, invalid email, or invalid verification payload</td></tr>
    <tr><td><code>403</code></td><td>Origin is not allowed</td></tr>
  </tbody>
</table>

</div>

<p align="center">
  For email delivery problems, inspect the newest <code>messages</code> document.
  The Trigger Email extension stamps delivery state and error details back onto
  the outbox document.
</p>

<h2 align="center">License</h2>

<p align="center">
  Verified Contact Form is licensed under the MIT License. See <a href="LICENSE">LICENSE</a>.
</p>
