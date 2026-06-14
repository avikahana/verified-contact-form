// Verified contact form (double opt-in).
//
// The form does NOT write to the database directly. It POSTs to the
// `request-verification` Cloud Function (same origin via Hosting rewrites),
// which holds the message and emails a magic link to the address typed. The
// message only reaches the owner after that link is clicked. This page polls
// `status` to flip the "Check your email" popup to a success state.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";

// --- Firebase web config (safe to expose; these are public identifiers). ---
// Replace with your project's values from the Firebase console.
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// reCAPTCHA v3 site key for App Check. Create it in the Firebase console
// (App Check -> reCAPTCHA v3) and paste the PUBLIC site key here. Leaving the
// REPLACE... placeholder disables App Check (fine for local development).
const RECAPTCHA_V3_SITE_KEY = "REPLACE_WITH_YOUR_RECAPTCHA_V3_SITE_KEY";

const app = initializeApp(firebaseConfig);

// The reCAPTCHA key is registered only for your production domain, so App Check
// can't mint a token on localhost — initializing it there just spams the console
// with errors. Skip init locally; the header helper below then no-ops.
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);

let appCheck = null;
try {
  if (!IS_LOCAL && RECAPTCHA_V3_SITE_KEY && !RECAPTCHA_V3_SITE_KEY.startsWith("REPLACE")) {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_V3_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (err) {
  console.warn("App Check init failed:", err);
}

// Best-effort App Check header — never blocks submission on the client side
// (the function enforces when it's ready).
export async function appCheckHeader() {
  if (!appCheck) return {};
  try {
    const { token } = await getToken(appCheck, false);
    return { "X-Firebase-AppCheck": token };
  } catch {
    return {};
  }
}

// ---- elements --------------------------------------------------------------

const form = document.getElementById("contactForm");
const sendBtn = form.querySelector('button[type="submit"]');
const warning = document.getElementById("message-warning");
const success = document.getElementById("message-success");

const popup = document.getElementById("verifyPopup");
const popupEmail = document.getElementById("vpEmail");
const resendBtn = document.getElementById("vpResend");
const closeBtns = popup.querySelectorAll("[data-vp-close]");

const POLL_MS = 3000;
const MAX_POLL_MS = (15 + 1) * 60 * 1000; // token TTL + a minute of slack

let pollTimer = null;
let pollDeadline = 0;
let lastPayload = null;

// ---- Send button + email format -------------------------------------------

// The Send button stays clickable even when the form is incomplete, so a click
// can surface guidance instead of silently doing nothing. All checks live in the
// submit handler below.
function refreshSendState() {
  sendBtn.disabled = false;
}
refreshSendState();

// Pragmatic email shape check: non-empty local part, "@", domain with a dot.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Clear a stale warning as soon as the visitor starts correcting the form.
form.addEventListener("input", () => {
  if (warning.style.display === "block") warning.style.display = "none";
});

// If the visitor was sent back here from the verification page (magic link
// confirmed in another tab), show the success banner above the form and tidy
// the URL so a refresh doesn't re-trigger it.
(function showSuccessIfReturning() {
  if (!new URLSearchParams(location.search).has("sent")) return;
  warning.style.display = "none";
  success.style.display = "block";
  history.replaceState(null, "", location.pathname + location.hash);
  success.scrollIntoView({ block: "center" });
})();

// ---- popup state -----------------------------------------------------------

function setPopupState(state) {
  popup.dataset.state = state; // "pending" | "expired"
}

function openPopup(email) {
  popupEmail.textContent = email;
  setPopupState("pending");
  popup.classList.add("is-open");
  document.body.style.overflow = "hidden";
}

function closePopup() {
  popup.classList.remove("is-open");
  document.body.style.overflow = "";
  stopPolling();
}

closeBtns.forEach((b) => b.addEventListener("click", closePopup));
resendBtn.addEventListener("click", () => {
  if (lastPayload) startVerification(lastPayload);
});

// ---- polling ---------------------------------------------------------------

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function poll(pendingId) {
  if (Date.now() > pollDeadline) {
    setPopupState("expired");
    return;
  }
  try {
    const res = await fetch(`/api/status?id=${encodeURIComponent(pendingId)}`);
    const data = await res.json();
    if (data.status === "verified") {
      closePopup();
      form.reset();
      refreshSendState();
      warning.style.display = "none";
      success.style.display = "block";
      return;
    }
    if (data.status === "expired") {
      setPopupState("expired");
      return;
    }
  } catch (err) {
    console.warn("status poll failed:", err);
  }
  pollTimer = setTimeout(() => poll(pendingId), POLL_MS);
}

// ---- submit ----------------------------------------------------------------

async function startVerification(payload) {
  warning.style.display = "none";
  success.style.display = "none";
  try {
    const res = await fetch("/api/request-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await appCheckHeader()) },
      body: JSON.stringify(payload),
    });
    if (res.status === 429) {
      showWarning("Too many attempts. Please try again later.");
      return;
    }
    if (!res.ok) {
      showWarning("Couldn't send your message. Please try again.");
      return;
    }
    const data = await res.json();
    if (!data.pendingId) {
      showWarning("Couldn't send your message. Please try again.");
      return;
    }
    openPopup(payload.email);
    pollDeadline = Date.now() + MAX_POLL_MS;
    stopPolling();
    poll(data.pendingId);
  } catch (err) {
    console.error("request-verification failed:", err);
    showWarning("Couldn't reach the server. Please try again.");
  }
}

function showWarning(text) {
  warning.textContent = text;
  warning.style.display = "block";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = val("name");
  const email = val("email");
  const subject = val("subject");
  const message = val("message");

  // 1) Every field must be filled in (the honeypot stays empty for real users).
  if (!name || name.length < 2 || !email || !subject || !message) {
    showWarning("Please complete all the fields before sending your message.");
    return;
  }
  // 2) The email must be a valid email address.
  if (!EMAIL_RE.test(email)) {
    showWarning("That email address doesn't look valid. Please enter a real email address.");
    return;
  }

  lastPayload = {
    name,
    email,
    subject,
    message,
    _hp: val("company"), // honeypot — real users leave this empty
  };
  await startVerification(lastPayload);
});

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}
