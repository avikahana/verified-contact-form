// Integration test: drives the REAL handlers from index.js against an in-memory
// Firestore fake (handy on machines with no JRE for the real emulator). The fake
// mimics the Firestore surface the code uses, including Date->Timestamp
// conversion on write so the rate-limit window logic is exercised faithfully.
//
// Run with:  node test-e2e.mjs   (after `npm install` in this folder)
import { Timestamp } from "firebase-admin/firestore";
import * as fns from "./index.js";

// ---- in-memory Firestore fake ----
let idSeq = 0;
const store = new Map(); // collection -> Map(id -> data)
const ensure = (c) => { if (!store.has(c)) store.set(c, new Map()); return store.get(c); };
const tsFromMillis = (ms) => ({ toMillis: () => ms, _ts: true });
function conv(v) {
  if (v instanceof Date) return tsFromMillis(v.getTime());
  if (v && typeof v.toMillis === "function") return v;
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = conv(v[k]); return o; }
  return v;
}
class DocRef {
  constructor(col, id) { this.col = col; this.id = id; }
  _get() { return store.get(this.col)?.get(this.id); }
  _set(data, merge) { const m = ensure(this.col); const c = conv(data); m.set(this.id, merge && m.has(this.id) ? { ...m.get(this.id), ...c } : c); }
  _update(data) { const m = ensure(this.col); m.set(this.id, { ...(m.get(this.id) || {}), ...conv(data) }); }
  _delete() { store.get(this.col)?.delete(this.id); }
  async get() { const d = this._get(); return { exists: d !== undefined, id: this.id, ref: this, data: () => d }; }
  async set(d, o) { this._set(d, !!o?.merge); }
  async update(d) { this._update(d); }
  async delete() { this._delete(); }
}
class ColRef {
  constructor(col) { this.col = col; }
  doc(id) { return new DocRef(this.col, id ?? `auto_${++idSeq}`); }
  async add(d) { const r = this.doc(); await r.set(d); return r; }
  async get() {
    const m = store.get(this.col) || new Map();
    const docs = [...m.entries()].map(([id, d]) => ({ exists: true, id, ref: new DocRef(this.col, id), data: () => d }));
    return { size: docs.length, docs, forEach: (f) => docs.forEach(f) };
  }
}
const fakeDb = {
  collection: (c) => new ColRef(c),
  async runTransaction(fn) {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, d, o) => ref._set(d, !!o?.merge),
      update: (ref, d) => ref._update(d),
      delete: (ref) => ref._delete(),
    };
    return fn(tx);
  },
};
fns.__setFirestore(fakeDb);
const db = fakeDb;

// ---- test plumbing ----
let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log("  ok:", m)) : (fail++, console.log("  FAIL:", m));
function mkReq({ method = "POST", body = {}, query = {}, headers = {}, ip = "1.2.3.4" } = {}) {
  return { method, body, query, headers, ip, rawBody: Buffer.from(JSON.stringify(body)) };
}
function mkRes() {
  const res = { statusCode: 200, body: null };
  let done; res._done = new Promise((r) => (done = r));
  res.set = () => res;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.body = o; done(res); return res; };
  res.send = (o) => { res.body = o; done(res); return res; };
  return res;
}
async function call(fn, reqOpts) { const res = mkRes(); await fn(mkReq(reqOpts), res); await res._done; return res; }
async function reset() { for (const c of ["pending_messages", "messages", "rate_limits"]) store.set(c, new Map()); }
function linkOf(html) { const m = html.match(/verify\.html\?id=([^&"]+)&token=([^&"]+)/); return m ? { id: decodeURIComponent(m[1]), token: decodeURIComponent(m[2]) } : null; }

async function run() {
  // Happy path
  await reset();
  let res = await call(fns.requestVerification, { body: { name: "Tester", email: "sender@example.com", subject: "Hello", message: "Hi there" } });
  ok(res.statusCode === 200 && !!res.body.pendingId, "request-verification returns pendingId");
  const pendingId = res.body.pendingId;
  let pend = await db.collection("pending_messages").doc(pendingId).get();
  ok(pend.exists && pend.data().status === "pending", "pending doc created status=pending");
  ok(!!pend.data().tokenHash && !pend.data().token, "token stored hashed, never plaintext");
  let mail = await db.collection("messages").get();
  ok(mail.size === 1 && mail.docs[0].data().to === "sender@example.com", "verify email queued to submitter");
  const link = linkOf(mail.docs[0].data().message.html);
  ok(!!link && link.id === pendingId, "verify link carries pendingId + token");
  res = await call(fns.status, { method: "GET", query: { id: pendingId } });
  ok(res.body.status === "pending", "status=pending before verify");
  res = await call(fns.verify, { body: { id: pendingId, token: "WRONG" } });
  ok(res.body.status === "invalid", "verify rejects wrong token");
  ok((await db.collection("messages").get()).size === 1, "owner email NOT sent on bad token");
  res = await call(fns.verify, { body: { id: pendingId, token: link.token } });
  ok(res.body.status === "verified", "verify accepts correct token");
  mail = await db.collection("messages").get();
  const owner = mail.docs.find((d) => d.data().to === "owner@example.com");
  ok(!!owner, "owner email released after verify");
  ok(owner && owner.data().replyTo === "sender@example.com", "owner email replyTo = submitter");
  res = await call(fns.status, { method: "GET", query: { id: pendingId } });
  ok(res.body.status === "verified", "status=verified after verify");
  res = await call(fns.verify, { body: { id: pendingId, token: link.token } });
  ok(res.body.status === "already", "token single-use (second verify = already)");

  // Honeypot
  await reset();
  res = await call(fns.requestVerification, { body: { name: "Bot", email: "bot@example.com", subject: "x", message: "y", _hp: "spam-co" } });
  ok(res.statusCode === 200, "honeypot returns fake success");
  ok((await db.collection("pending_messages").get()).size === 0, "honeypot writes no pending doc");
  ok((await db.collection("messages").get()).size === 0, "honeypot sends no email");

  // Bad email
  await reset();
  res = await call(fns.requestVerification, { body: { name: "X", email: "not-an-email", subject: "s", message: "m" } });
  ok(res.statusCode === 400 && res.body.error === "email", "invalid email rejected (400)");

  // Missing field
  res = await call(fns.requestVerification, { body: { name: "", email: "a@b.co", subject: "s", message: "m" } });
  ok(res.statusCode === 400 && res.body.error === "missing", "missing name rejected (400)");

  // Expiry
  await reset();
  res = await call(fns.requestVerification, { body: { name: "T", email: "exp@example.com", subject: "s", message: "m" } });
  const expId = res.body.pendingId;
  await db.collection("pending_messages").doc(expId).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  res = await call(fns.status, { method: "GET", query: { id: expId } });
  ok(res.body.status === "expired", "status=expired past TTL");
  const expLink = linkOf((await db.collection("messages").get()).docs[0].data().message.html);
  res = await call(fns.verify, { body: { id: expId, token: expLink.token } });
  ok(res.body.status === "expired", "verify rejects expired token");

  // status for unknown id
  res = await call(fns.status, { method: "GET", query: { id: "does-not-exist" } });
  ok(res.body.status === "expired", "status=expired for unknown id");

  // Rate limit (per email max 3)
  await reset();
  const codes = [];
  for (let i = 0; i < 5; i++) {
    res = await call(fns.requestVerification, { body: { name: "R", email: "rate@example.com", subject: "s", message: "m" }, ip: `9.9.9.${i}` });
    codes.push(res.statusCode);
  }
  ok(codes.filter((s) => s === 200).length === 3, "per-email rate limit allows 3");
  ok(codes.filter((s) => s === 429).length === 2, "per-email rate limit blocks rest (429)");

  // Method guard
  res = await call(fns.requestVerification, { method: "GET" });
  ok(res.statusCode === 405, "request-verification rejects GET (405)");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
