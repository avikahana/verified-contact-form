import crypto from "node:crypto";
import { getAppCheck } from "firebase-admin/app-check";
import {
  ALLOWED_ORIGINS,
  APP_CHECK_ENFORCE,
  RATE_LIMIT_COLLECTION,
  RATE_LIMIT_MAX_PER_EMAIL,
  RATE_LIMIT_MAX_PER_IP,
  RATE_LIMIT_WINDOW_MINUTES,
} from "./config.js";

// ---- email ----------------------------------------------------------------

// Pragmatic email format check (RFC-perfect validation is neither possible nor
// useful here). Length caps guard against abuse / oversized docs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length >= 3 &&
    email.length <= 254 &&
    EMAIL_RE.test(email)
  );
}

// ---- tokens ----------------------------------------------------------------

export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Constant-time compare of two hex digests of equal length.
export function tokensMatch(token, storedHash) {
  const candidate = hashToken(token);
  const a = Buffer.from(candidate, "utf8");
  const b = Buffer.from(storedHash || "", "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---- request hardening -----------------------------------------------------

// Reject obvious cross-origin abuse. Same-origin calls via Hosting rewrites
// usually send no Origin header at all — those are allowed.
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin / server-to-server
  return ALLOWED_ORIGINS.includes(origin);
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  return req.ip || "unknown";
}

// Verify the Firebase App Check token from the X-Firebase-AppCheck header.
// In monitor mode (APP_CHECK_ENFORCE=false) failures are logged but allowed,
// so you can watch metrics before turning on hard enforcement.
export async function appCheckOk(req, logger) {
  const token = req.headers["x-firebase-appcheck"];
  if (!token) {
    if (APP_CHECK_ENFORCE) return false;
    logger?.warn("App Check token missing (monitor mode — allowing)");
    return true;
  }
  try {
    await getAppCheck().verifyToken(token);
    return true;
  } catch (err) {
    if (APP_CHECK_ENFORCE) return false;
    logger?.warn("App Check verify failed (monitor mode — allowing)", err?.message);
    return true;
  }
}

// ---- rate limiting ---------------------------------------------------------

// Fixed-window counter stored in Firestore, keyed by a stable id (ip:... or
// email:...). Returns true when the request is within budget.
export async function underRateLimit(db, key, max, windowMinutes = RATE_LIMIT_WINDOW_MINUTES) {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(key);
  const windowMs = windowMinutes * 60 * 1000;
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const windowStart = data?.windowStart?.toMillis?.() ?? 0;
    const fresh = !data || now - windowStart > windowMs;
    const count = fresh ? 0 : data.count || 0;
    if (count >= max) return false;
    tx.set(
      ref,
      {
        count: count + 1,
        windowStart: fresh ? new Date(now) : data.windowStart,
        // expiresAt lets the TTL policy reap stale counters.
        expiresAt: new Date(now + windowMs),
      },
      { merge: true }
    );
    return true;
  });
}

export async function withinAllRateLimits(db, ip, email) {
  const ipOk = await underRateLimit(db, `ip:${ip}`, RATE_LIMIT_MAX_PER_IP);
  if (!ipOk) return false;
  const emailOk = await underRateLimit(
    db,
    `email:${email.toLowerCase()}`,
    RATE_LIMIT_MAX_PER_EMAIL
  );
  return emailOk;
}

// ---- request/response helpers ----------------------------------------------

// Same-origin /api/* calls via Hosting rewrites send no Origin header; for
// cross-origin tries we echo back only allow-listed origins.
export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Firebase-AppCheck");
}

// onRequest parses JSON bodies automatically; fall back to manual parse.
export function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.rawBody?.toString() || "{}");
  } catch {
    return {};
  }
}

// ---- misc ------------------------------------------------------------------

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Trim + cap a free-text field; returns "" for non-strings.
export function clean(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}
