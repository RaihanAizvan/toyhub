import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";

import userAuth from "../controllers/userModules/auth.js";
import { resetRateLimits } from "../controllers/userModules/auth.js";
import User from "../models/users.models.js";
import { hashToken, randomNumericOtp } from "../utils/auth-tokens.js";
import { passwordPolicyScript } from "../utils/password-policy.js";
import { phonePolicyScript } from "../utils/phone-number.js";
import { setMailTransport } from "../utils/mailer.js";
import * as rateLimit from "../utils/rate-limit.js";
import { requestSource } from "../utils/rate-limit.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createUser } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const mail = [];
setMailTransport({
  sendMail: async (message) => {
    mail.push(message);
    return { messageId: `test-${mail.length}` };
  },
});

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  // So a test can say which caller it is speaking for, the way a real deployment
  // behind a proxy does.
  app.set("trust proxy", true);
  app.locals.passwordPolicyScript = passwordPolicyScript;
  app.locals.phonePolicyScript = phonePolicyScript;
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "t".repeat(32),
      resave: false,
      saveUninitialized: false,
    }),
  );

  app.post("/user/signup", userAuth.postSignup);
  app.get("/user/otp", userAuth.getOtp);
  app.post("/user/otp", userAuth.postOtp);
  app.post("/user/resend-otp", userAuth.postResendOtp);
  app.post("/user/login", userAuth.postLogin);

  // Stands in for the step that puts an address into the session during signup.
  // A blocked account already exists, so signup will not do it, and the OTP
  // routes read the address from the session rather than the request.
  app.get("/test/session-email", (req, res) => {
    req.session.email = String(req.query.email ?? "");
    res.json({ email: req.session.email });
  });

  return app;
};

let server;
let baseUrl;
let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => {
    if (!server) {
      return resolve();
    }
    server.close(resolve);
    server.closeAllConnections?.();
  });
});

beforeEach(() => {
  mail.length = 0;
  // The counters live in the process, so each test starts from zero rather than
  // inheriting what the last one spent.
  resetRateLimits();
});

const send = (path, { method = "POST", body = {}, cookie, from } = {}) => {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) {
    headers.cookie = cookie;
  }
  if (from) {
    headers["x-forwarded-for"] = from;
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : new URLSearchParams(body).toString(),
    redirect: "manual",
  }).then(async (response) => ({
    status: response.status,
    text: await response.text(),
    setCookie: response.headers.get("set-cookie") ?? "",
  }));
};

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    resetRateLimits();
    return withTestDatabase(fn);
  });

const strongPassword = "TestPassw0rd!";

const openVerificationSession = async (email) => {
  const response = await fetch(
    `${baseUrl}/test/session-email?email=${encodeURIComponent(email)}`,
    { redirect: "manual" },
  );
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
};

// Signs up and returns the session cookie, which is what the OTP routes read to
// know who is verifying.
const startSignup = async (email, from) => {
  const signup = await send("/user/signup", {
    body: {
      name: "Otp User",
      email,
      phone_number: "9000000004",
      password: strongPassword,
      confirmPassword: strongPassword,
    },
    from,
  });
  return signup.setCookie.split(";")[0];
};

const digits = (code) => {
  const boxes = {};
  [...code].forEach((character, index) => {
    boxes[`otp${index + 1}`] = character;
  });
  return boxes;
};

const lastOtp = () => {
  const message = [...mail].reverse().find((entry) => entry.subject.includes("OTP"));
  const match = message?.text?.match(/\b(\d{6})\b/);
  return match?.[1] ?? null;
};

describe("authentication limits", () => {
  it("reads the caller's address from what Express says to trust", () => {
    assert.equal(requestSource({ ip: "203.0.113.9" }), "203.0.113.9");
    assert.equal(requestSource({ ip: "::ffff:127.0.0.1" }), "127.0.0.1", "one caller, not two");
    assert.equal(requestSource({ ip: "" }), "unknown");
    assert.equal(requestSource({}), "unknown");
  });

  whenReachable("the OTP is never written to the log", async () => {
    const lines = [];
    const original = console.log;
    const originalInfo = console.info;
    console.log = (...args) => lines.push(args.join(" "));
    console.info = (...args) => lines.push(args.join(" "));
    try {
      await startSignup("otp.logged@example.invalid");
    } finally {
      console.log = original;
      console.info = originalInfo;
    }

    const code = lastOtp();
    assert.match(code ?? "", /^\d{6}$/, "the mail itself still carries the code");
    assert.ok(
      !lines.some((line) => line.includes(code)),
      `the code reached the log output: ${lines.join(" | ")}`,
    );
  });

  whenReachable("one caller cannot walk a list of accounts", async () => {
    const addresses = [];
    for (let index = 0; index < 40; index += 1) {
      addresses.push(`guess${index}@example.invalid`);
    }
    for (const email of addresses) {
      await createUser({ email });
    }

    // Every attempt has a different account, so the per-account lock never
    // starts. Only a limit counted by caller stops this.
    let refused = 0;
    for (const email of addresses) {
      const response = await send("/user/login", {
        body: { email, password: "WrongPassw0rd!" },
        from: "198.51.100.5",
      });
      if (response.status === 429) {
        refused += 1;
      }
    }

    assert.ok(refused > 0, "a caller tried 40 accounts and was never slowed down");
  });

  whenReachable("a different caller is not affected by another's failures", async () => {
    await createUser({ email: "shared@example.invalid" });

    for (let index = 0; index < 30; index += 1) {
      await send("/user/login", {
        body: { email: "shared@example.invalid", password: "WrongPassw0rd!" },
        from: "198.51.100.7",
      });
    }

    const other = await send("/user/login", {
      body: { email: "shared@example.invalid", password: "WrongPassw0rd!" },
      from: "203.0.113.44",
    });
    assert.equal(other.status, 401, "a wrong password is still a wrong password, not a 429");
    assert.match(other.text, /Invalid email or password/);
  });

  whenReachable("a correct password still signs in after earlier failures", async () => {
    await createUser({ email: "forgiven@example.invalid", password: strongPassword });

    // A handful of failures from this caller, all on other accounts so the
    // per-account lock is not what stops anything.
    for (let index = 0; index < 6; index += 1) {
      await createUser({ email: `elsewhere${index}@example.invalid` });
      await send("/user/login", {
        body: { email: `elsewhere${index}@example.invalid`, password: "WrongPassw0rd!" },
        from: "198.51.100.9",
      });
    }

    const good = await send("/user/login", {
      body: { email: "forgiven@example.invalid", password: strongPassword },
      from: "198.51.100.9",
    });
    assert.equal(good.status, 302, "the right password still signs in");
  });

  it("a success clears what the caller had spent", () => {
    // The counter itself, rather than thirty password hashes to walk it up to.
    const { hit, clear } = rateLimit;
    resetRateLimits();

    for (let index = 0; index < 3; index += 1) {
      assert.equal(hit("probe", "198.51.100.1", 3, 60000).allowed, true);
    }
    assert.equal(hit("probe", "198.51.100.1", 3, 60000).allowed, false, "fourth is refused");

    clear("probe", "198.51.100.1");
    assert.equal(
      hit("probe", "198.51.100.1", 3, 60000).allowed,
      true,
      "after clearing, the allowance is whole again",
    );
  });

  whenReachable("an answer that is not six digits never reaches the hash", async () => {
    const cookie = await startSignup("otp.shape@example.invalid");
    const code = lastOtp();
    assert.match(code ?? "", /^\d{6}$/);

    // The six boxes are one character each in the browser, but a request can say
    // anything at all.
    const shaped = await send("/user/otp", {
      cookie,
      body: { otp1: "not", otp2: "digits", otp3: "", otp4: "", otp5: "", otp6: "" },
    });
    assert.equal(shaped.status, 400);
    assert.match(shaped.text, /That code is not valid/);

    const stored = await User.findOne({ email: "otp.shape@example.invalid" }).lean();
    assert.equal(stored.verified, false, "the account is still unverified");
    assert.ok(stored.otpHash, "the code they were sent is still the pending one");
    assert.equal(stored.otpAttempts, 0, "and it has not spent one of its guesses");
  });

  whenReachable("too many guesses from one caller are stopped", async () => {
    const cookie = await startSignup("otp.flooded@example.invalid");
    const code = lastOtp();

    let refused = 0;
    for (let index = 0; index < 25; index += 1) {
      const response = await send("/user/otp", {
        cookie,
        body: digits("000000" === code ? "111111" : "000000"),
        from: "198.51.100.20",
      });
      if (response.status === 429) {
        refused += 1;
      }
    }

    assert.ok(refused > 0, "25 guesses from one caller were all let through");
  });

  whenReachable("a blocked account cannot be verified, and is not told why", async () => {
    await createUser({
      email: "blocked.otp@example.invalid",
      verified: false,
      isBlocked: true,
    });

    const otp = "654321";
    await User.updateOne(
      { email: "blocked.otp@example.invalid" },
      {
        $set: {
          otpHash: hashToken(otp),
          otpExpires: new Date(Date.now() + 5 * 60 * 1000),
          otpIssuedAt: new Date(),
          otpAttempts: 0,
        },
      },
    );

    // A session that says this is who is verifying, as the signup flow would.
    const cookie = await openVerificationSession("blocked.otp@example.invalid");

    const response = await send("/user/otp", { cookie, body: digits(otp) });

    assert.notEqual(response.status, 302, "a blocked account was verified and sent to login");
    assert.match(
      response.text,
      /That code is not valid/,
      "it gets the same sentence as a wrong code",
    );

    const stored = await User.findOne({ email: "blocked.otp@example.invalid" }).lean();
    assert.equal(stored.verified, false, "the account is still blocked and unverified");
  });

  whenReachable("a blocked account gets no new codes", async () => {
    await createUser({
      email: "blocked.resend@example.invalid",
      verified: false,
      isBlocked: true,
      otpIssuedAt: new Date(Date.now() - 10 * 60 * 1000),
      otpHash: hashToken(randomNumericOtp()),
      otpExpires: new Date(Date.now() + 5 * 60 * 1000),
    });

    const cookie = await openVerificationSession("blocked.resend@example.invalid");
    const before = mail.length;

    const response = await send("/user/resend-otp", { cookie });

    assert.equal(response.status, 403);
    assert.equal(mail.length, before, "no code was sent to a blocked account");
    assert.match(response.text, /That code is not valid/);
  });

  whenReachable("asking for another code is a POST, not a link", async () => {
    const asGet = await send("/user/resend-otp", { method: "GET" });
    assert.equal(
      asGet.status,
      404,
      "a GET still reaches the route, so the protection would be the CSRF check and it skips GET",
    );
  });
});