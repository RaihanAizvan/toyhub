import assert from "node:assert/strict";
import { after, before, it } from "node:test";

import User from "../models/users.models.js";
import { completeGoogleLogin } from "../routes/googleAuthRoute.js";
import { verifyGoogleProfile } from "../utils/passport.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createUser, objectId } from "./helpers/fixtures.js";

applyTestEnv();

let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
});

after(async () => {
  // The helper connects and disconnects around each test.
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return withTestDatabase(fn);
  });

const makeRes = () => ({
  location: null,
  redirect(path) {
    this.location = path;
    return this;
  },
});

const makeReq = (userId) => {
  const state = { regenerated: 0 };
  const session = {
    marker: "kept",
    regenerate(callback) {
      state.regenerated += 1;
      delete this.marker;
      delete this.user;
      callback(null);
    },
  };
  return {
    req: { user: userId ? { id: String(userId) } : undefined, session },
    session,
    state,
  };
};

const profile = (overrides = {}) => ({
  id: "google-123",
  displayName: "Google Person",
  emails: [{ value: "google.person@example.invalid", verified: true }],
  ...overrides,
});

const runStrategy = (value) =>
  new Promise((resolve) => {
    verifyGoogleProfile(null, "access", null, value, (error, user) => resolve({ error, user }));
  });

whenReachable("a completed Google login replaces the session before storing the user", async () => {
  const user = await createUser({ name: "Google Person", email: "google@example.invalid" });
  const { req, session, state } = makeReq(user._id);
  const res = makeRes();

  await completeGoogleLogin(req, res);

  assert.equal(state.regenerated, 1, "the pre-login session is not reused");
  assert.equal(res.location, "/");
  assert.equal(session.user.id, String(user._id));
  assert.equal(session.user.email, "google@example.invalid");
  assert.equal(session.user.name, "Google Person");
});

whenReachable("a blocked Google account is sent to login without a session", async () => {
  const user = await createUser({ name: "Blocked Person", isBlocked: true });
  const { req, session, state } = makeReq(user._id);
  const res = makeRes();

  await completeGoogleLogin(req, res);

  assert.equal(state.regenerated, 1, "the passport session is cleared");
  assert.equal(res.location, "/user/login?blocked=true");
  assert.equal(session.user, undefined, "a blocked account is never signed in");
});

whenReachable("an account deleted before the callback is not a crash", async () => {
  const { req, session, state } = makeReq(objectId());
  const res = makeRes();

  await completeGoogleLogin(req, res);

  assert.equal(res.location, "/user/login?error=account");
  assert.equal(state.regenerated, 0);
  assert.equal(session.user, undefined);
});

whenReachable("a callback with no passport user is handled", async () => {
  const { req } = makeReq(null);
  const res = makeRes();

  await completeGoogleLogin(req, res);

  assert.equal(res.location, "/user/login?error=account");
});

whenReachable("a new Google account is created verified and linked", async () => {
  const result = await runStrategy(profile());

  assert.equal(result.error, null);
  assert.equal(result.user.googleId, "google-123");
  assert.equal(result.user.verified, true, "Google proved the address");
  const stored = await User.findById(result.user._id).lean();
  assert.equal(stored.email, "google.person@example.invalid");
});

whenReachable("an existing password account is linked to its Google id", async () => {
  const existing = await createUser({ email: "link.me@example.invalid", verified: false });

  const result = await runStrategy(
    profile({
      id: "google-999",
      emails: [{ value: "link.me@example.invalid", verified: true }],
    }),
  );

  assert.equal(result.error, null);
  assert.equal(String(result.user._id), String(existing._id), "the same account, not a second one");
  assert.equal(result.user.googleId, "google-999");
  assert.equal(result.user.verified, true);
  assert.equal(await User.countDocuments({ email: "link.me@example.invalid" }), 1);
});

whenReachable("a Google profile without an email is refused", async () => {
  const result = await runStrategy(profile({ emails: [] }));

  assert.ok(result.error, "there is nothing to match an account on");
  assert.equal(result.user, null);
});
