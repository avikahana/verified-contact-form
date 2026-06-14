import { OWNER_EMAIL, SITE_NAME, SITE_ORIGIN } from "./config.js";
import { escapeHtml } from "./util.js";

const BRAND = "#2563eb"; // accent colour used in the emails

// Document written to the `messages` collection that asks the visitor to
// confirm they own the address they typed. Sent BEFORE anything reaches the owner.
export function buildVerifyEmail({ name, email, pendingId, token }) {
  const link = `${SITE_ORIGIN}/verify.html?id=${encodeURIComponent(
    pendingId
  )}&token=${encodeURIComponent(token)}`;
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";
  return {
    to: email, // the submitter — gated by App Check + rate limit, never an open relay
    message: {
      subject: `Confirm your message to ${SITE_NAME}`,
      text:
        `${name ? `Hi ${name},` : "Hi,"}\n\n` +
        `You (or someone using your email) sent a message through the ${SITE_NAME} ` +
        "contact form. To deliver it, confirm your email by opening this link " +
        `within 15 minutes:\n\n${link}\n\n` +
        "If you didn't request this, you can safely ignore this email — " +
        "nothing will be sent.",
      html:
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c1c1c;line-height:1.6">' +
        `<p>${greeting}</p>` +
        "<p>You (or someone using your email) sent a message through the " +
        `<strong>${escapeHtml(SITE_NAME)}</strong> contact form. To deliver it, please ` +
        "confirm your email within 15 minutes:</p>" +
        `<p style="margin:24px 0"><a href="${link}" ` +
        `style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;` +
        'border-radius:6px;display:inline-block;font-weight:600">Confirm &amp; send my message</a></p>' +
        '<p style="font-size:13px;color:#666">Or paste this link into your browser:<br>' +
        `<a href="${link}">${escapeHtml(link)}</a></p>` +
        '<p style="font-size:13px;color:#666">If you didn\'t request this, just ignore ' +
        "this email — nothing will be sent.</p>" +
        "</div>",
    },
  };
}

// Document written to `messages` AFTER verification — the real notification to
// the site owner.
export function buildOwnerEmail({ name, email, subject, body }) {
  return {
    to: OWNER_EMAIL,
    replyTo: email,
    message: {
      subject: `[${SITE_NAME}] ${subject}`,
      text:
        `New (verified) message from the ${SITE_NAME} contact form\n\n` +
        `Name:    ${name}\n` +
        `Email:   ${email}  (ownership verified)\n` +
        `Subject: ${subject}\n\n` +
        body,
      html:
        '<div style="font-family:Arial,Helvetica,sans-serif;color:#1c1c1c;line-height:1.5">' +
        `<h2 style="margin:0 0 12px;color:${BRAND}">New verified message from ${escapeHtml(SITE_NAME)}</h2>` +
        `<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
        `<strong>Email:</strong> ${escapeHtml(email)} ` +
        '<span style="color:#1a9c5b">✓ verified</span><br>' +
        `<strong>Subject:</strong> ${escapeHtml(subject)}</p>` +
        '<div style="white-space:pre-wrap;padding:12px 16px;background:#f4f7f9;' +
        `border-left:3px solid ${BRAND};border-radius:4px">${escapeHtml(body)}</div>` +
        "</div>",
    },
  };
}
