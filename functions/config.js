// Central config for the verified-contact-form functions.
// Override any value via environment variables at deploy time (see .env.example).

export const REGION = process.env.FUNCTIONS_REGION || "us-central1"; // must match the Trigger Email extension

// Public site origin — used to build magic links and to lock down callers.
export const SITE_ORIGIN = process.env.SITE_ORIGIN || "https://example.com";

// Human-readable site name shown in the verification emails.
export const SITE_NAME = process.env.SITE_NAME || "Example Site";

// Origins allowed to call request-verification. Same-origin calls via Hosting
// rewrites send no Origin header and are allowed; this is defence-in-depth for
// cross-origin tries.
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [SITE_ORIGIN];

// Where verified messages are delivered. Set server-side (via env) so the public
// form can never be turned into an open relay.
export const OWNER_EMAIL = process.env.OWNER_EMAIL || "owner@example.com";

// Collections.
export const MESSAGES_COLLECTION = "messages"; // watched by the Trigger Email ext
export const PENDING_COLLECTION = "pending_messages";
export const RATE_LIMIT_COLLECTION = "rate_limits";

// Verification token lifetime.
export const TOKEN_TTL_MINUTES = 15;

// Rate limiting (fixed window).
export const RATE_LIMIT_WINDOW_MINUTES = 60;
export const RATE_LIMIT_MAX_PER_IP = 5;
export const RATE_LIMIT_MAX_PER_EMAIL = 3;

// App Check: start in monitor mode (log failures, allow), flip to true to enforce.
export const APP_CHECK_ENFORCE = process.env.APP_CHECK_ENFORCE === "true";
