import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";

import {
  MESSAGES_COLLECTION,
  PENDING_COLLECTION,
  REGION,
  TOKEN_TTL_MINUTES,
} from "./config.js";
import { buildOwnerEmail, buildVerifyEmail } from "./email.js";
import {
  appCheckOk,
  applyCors,
  clean,
  clientIp,
  generateToken,
  hashToken,
  isValidEmail,
  originAllowed,
  readBody,
  tokensMatch,
  withinAllRateLimits,
} from "./util.js";

initializeApp();
let db = getFirestore();
setGlobalOptions({ region: REGION, maxInstances: 10 });

// Test seam: lets the integration test inject an in-memory Firestore. Never
// called in production (the real getFirestore() instance is used as-is).
export function __setFirestore(fake) {
  db = fake;
}

// ===========================================================================
// 1) request-verification — hold the message, email a magic link to the sender
// ===========================================================================
export const requestVerification = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  if (!originAllowed(req)) {
    logger.warn("Blocked origin", req.headers.origin);
    return res.status(403).json({ error: "forbidden" });
  }
  if (!(await appCheckOk(req, logger))) {
    return res.status(401).json({ error: "appcheck" });
  }

  const body = readBody(req);

  // Honeypot: real users never fill a hidden field. Pretend success so bots
  // don't learn they were caught.
  if (clean(body._hp, 100)) {
    logger.info("Honeypot tripped");
    return res.status(200).json({ pendingId: "ok" });
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 254);
  const subject = clean(body.subject, 200);
  const message = clean(body.message, 5000);

  if (!name || !subject || !message) {
    return res.status(400).json({ error: "missing" });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "email" });
  }

  const ip = clientIp(req);
  if (!(await withinAllRateLimits(db, ip, email))) {
    logger.warn("Rate limited", { ip, email });
    return res.status(429).json({ error: "rate" });
  }

  // Create the pending record. Token plaintext goes only into the email link.
  const token = generateToken();
  const expiresAt = Timestamp.fromMillis(
    Date.now() + TOKEN_TTL_MINUTES * 60 * 1000
  );
  const pendingRef = db.collection(PENDING_COLLECTION).doc();
  await pendingRef.set({
    name,
    email,
    subject,
    body: message,
    tokenHash: hashToken(token),
    status: "pending",
    ip,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });

  // Send the verification email via the Trigger Email extension.
  await db
    .collection(MESSAGES_COLLECTION)
    .add(buildVerifyEmail({ name, email, pendingId: pendingRef.id, token }));

  logger.info("Verification requested", { pendingId: pendingRef.id });
  return res.status(200).json({ pendingId: pendingRef.id });
});

// ===========================================================================
// 2) verify — consume the token (single-use) and release the message to the owner
// ===========================================================================
export const verify = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  // POST-on-load (verify.html) avoids link-scanner prefetch burning the token.
  if (req.method !== "POST") return res.status(405).json({ error: "method" });

  const body = readBody(req);
  const id = clean(body.id, 200);
  const token = clean(body.token, 200);
  if (!id || !token) return res.status(400).json({ status: "invalid" });

  const ref = db.collection(PENDING_COLLECTION).doc(id);

  let outcome;
  let ownerEmail = null;
  try {
    outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return "invalid";
      const data = snap.data();
      if (data.status === "consumed") return "already";
      if (data.expiresAt.toMillis() < Date.now()) return "expired";
      if (!tokensMatch(token, data.tokenHash)) return "invalid";

      tx.update(ref, {
        status: "consumed",
        consumedAt: FieldValue.serverTimestamp(),
      });
      ownerEmail = buildOwnerEmail({
        name: data.name,
        email: data.email,
        subject: data.subject,
        body: data.body,
      });
      return "verified";
    });
  } catch (err) {
    logger.error("verify transaction failed", err);
    return res.status(500).json({ status: "error" });
  }

  // Deliver to the owner only after the token was consumed inside the transaction.
  if (outcome === "verified" && ownerEmail) {
    await db.collection(MESSAGES_COLLECTION).add(ownerEmail);
    logger.info("Message verified + released", { pendingId: id });
  }

  return res.status(200).json({ status: outcome });
});

// ===========================================================================
// 3) status — polled by the page's "Check your email" popup
// ===========================================================================
export const status = onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "method" });

  const id = clean(req.query.id, 200);
  if (!id) return res.status(400).json({ status: "expired" });

  const snap = await db.collection(PENDING_COLLECTION).doc(id).get();
  // Missing doc = never existed or already TTL-reaped → treat as expired so the
  // popup offers "resend". Never leak message content here.
  if (!snap.exists) return res.status(200).json({ status: "expired" });

  const data = snap.data();
  if (data.status === "consumed") return res.status(200).json({ status: "verified" });
  if (data.expiresAt.toMillis() < Date.now()) {
    return res.status(200).json({ status: "expired" });
  }
  return res.status(200).json({ status: "pending" });
});
