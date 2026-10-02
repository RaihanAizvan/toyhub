import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import userAuth from "../controllers/userModules/auth.js";
import User from "../models/users.models.js";
import { hashToken, safeEqual } from "../utils/auth-tokens.js";
import { passwordPolicyScript, isStrongPassword } from "../utils/password-policy.js";
import { phonePolicyScript, isValidPhoneNumber, normalizePhoneNumber } from "../utils/phone-number.js";
import { getSessionStore } from "../utils/session.js";
import { setMailTransport } from "../utils/mailer.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  withTestDatabase,
} from "./helpers/test-db.js";
import { createUser } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const sentMail = [];
setMailTransport({
  sendMail: async (message) => {
    sentMail.push(message);
    return { messageId: `test-${sentMail.length}` };
  },
});

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  // The signup and reset pages are handed the password and phone rules by the
  // server, the same way the real server hands them to the browser.
  app.locals.passwordPolicyScript = passwordPolicyScript;
  app.locals.phonePolicyScript = phonePolicyScript;
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
  app.get("/user/session", (req, res) =>
    res.json({ user: req.session.user ?? null }),
  );
  app.post("/user/forgot-password", userAuth.postForgotPassword);
  app.get("/user/reset-password", userAuth.getResetPassword);
  app.post("/user/reset-password", userAuth.postResetPassword);

  return app;
};

const startServer = async () => {
  const server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
  };
};

const send = async (server, path, { method = "POST", body, cookie } = {}) => {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    cookie: response.headers.getSetCookie?.()[0]?.split(";")[0] ?? null,
    text: await response.text(),
  };
};

const closeGlobalSessionStore = async () => {
  try {
    await getSessionStore().close?.();
  } catch {
    // The store is only created when a flow invalidates sessions.
  }
};

const lastOtpMail = () => {
  const mail = sentMail.at(-1);
  return mail ? /(\d{6})/.exec(mail.text ?? "")?.[1] : undefined;
};

const otpFields = (otp) =>
  Object.fromEntries(
    otp.split("").map((digit, index) => [`otp${index + 1}`, digit]),
  );

describe("signup OTP verification", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    if (server) {
      await server.close();
    }
  });

  const withDatabase = (run) => (reachable ? withTestDatabase(run) : null);

  it("stores the OTP hashed and never as a plaintext number", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      sentMail.length = 0;
      const signup = await send(server, "/user/signup", {
        body: {
          name: "Otp User",
          email: "otp.user@example.invalid",
          phone_number: "9000000001",
          password: "TestPassw0rd!",
          confirmPassword: "TestPassw0rd!",
        },
      });
      assert.equal(signup.location, "/user/otp");

      const otp = lastOtpMail();
      assert.match(otp, /^\d{6}$/);

      const user = await User.findOne({ email: "otp.user@example.invalid" }).lean();
      assert.ok(user.otpHash);
      assert.equal(user.otp, undefined, "plaintext otp must not be stored");
      assert.ok(safeEqual(user.otpHash, hashToken(otp)));
      assert.ok(user.otpExpires.getTime() > Date.now());
      assert.equal(user.otpAttempts, 0);
    });
  });

  it("accepts the correct OTP once and refuses to reuse it", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      sentMail.length = 0;
      const signup = await send(server, "/user/signup", {
        body: {
          name: "Otp User",
          email: "otp.once@example.invalid",
          phone_number: "9000000002",
          password: "TestPassw0rd!",
          confirmPassword: "TestPassw0rd!",
        },
      });
      const otp = lastOtpMail();
      const cookie = signup.cookie;

      const accepted = await send(server, "/user/otp", {
        body: otpFields(otp),
        cookie,
      });
      assert.equal(accepted.location, "/user/login");

      const user = await User.findOne({ email: "otp.once@example.invalid" }).lean();
      assert.equal(user.verified, true);
      assert.equal(user.otpHash, null, "the OTP must be cleared after use");

      const reused = await send(server, "/user/otp", {
        body: otpFields(otp),
        cookie,
      });
      assert.notEqual(reused.location, "/user/login");
      assert.match(reused.location, /\/user\/signup/);
    });
  });

  it("bounds wrong OTP attempts and refuses an expired OTP", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      sentMail.length = 0;
      const signup = await send(server, "/user/signup", {
        body: {
          name: "Otp User",
          email: "otp.attempts@example.invalid",
          phone_number: "9000000003",
          password: "TestPassw0rd!",
          confirmPassword: "TestPassw0rd!",
        },
      });
      const cookie = signup.cookie;

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const wrong = await send(server, "/user/otp", {
          body: otpFields("000000"),
          cookie,
        });
        assert.equal(wrong.status, 400, `attempt ${attempt} should be a plain rejection`);
      }

      const locked = await send(server, "/user/otp", {
        body: otpFields("000000"),
        cookie,
      });
      assert.equal(locked.status, 429);

      const user = await User.findOne({ email: "otp.attempts@example.invalid" }).lean();
      assert.equal(user.otpAttempts, 5);
      assert.equal(user.verified, false);

      await User.updateOne(
        { _id: user._id },
        { $set: { otpExpires: new Date(Date.now() - 1000), otpAttempts: 0 } },
      );
      const expired = await send(server, "/user/otp", {
        body: otpFields("123456"),
        cookie,
      });
      assert.equal(expired.status, 400);
      assert.match(expired.text, /not valid/);
    });
  });

  it("rate limits OTP resends per account", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      sentMail.length = 0;
      const signup = await send(server, "/user/signup", {
        body: {
          name: "Otp User",
          email: "otp.resend@example.invalid",
          phone_number: "9000000004",
          password: "TestPassw0rd!",
          confirmPassword: "TestPassw0rd!",
        },
      });
      const cookie = signup.cookie;

      const cooldown = await send(server, "/user/resend-otp", {
        method: "POST",
        cookie,
      });
      assert.equal(cooldown.status, 429);

      await User.updateOne(
        { email: "otp.resend@example.invalid" },
        { $set: { otpIssuedAt: new Date(Date.now() - 10 * 60 * 1000) } },
      );

      const resendAfterCooldown = async () => {
        await User.updateOne(
          { email: "otp.resend@example.invalid" },
          { $set: { otpIssuedAt: new Date(Date.now() - 10 * 60 * 1000) } },
        );
        return send(server, "/user/resend-otp", { method: "POST", cookie });
      };

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const response = await resendAfterCooldown();
        assert.equal(response.status, 200, `resend ${attempt} should be allowed`);
      }
      assert.ok(lastOtpMail());

      const limited = await resendAfterCooldown();
      assert.equal(limited.status, 429);
      assert.match(limited.text, /Too many codes/);
    });
  });
});

describe("user login", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    if (server) {
      await server.close();
    }
  });

  const withDatabase = (run) => (reachable ? withTestDatabase(run) : null);

  it("answers unknown, wrong-password and blocked accounts identically", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "login.user@example.invalid" });
      const blocked = await createUser({
        email: "login.blocked@example.invalid",
        isBlocked: true,
      });

      const attempts = [
        { email: "nobody@example.invalid", password: "TestPassw0rd!" },
        { email: user.email, password: "WrongPassw0rd!" },
        { email: blocked.email, password: "TestPassw0rd!" },
      ];

      const responses = [];
      for (const body of attempts) {
        const response = await send(server, "/user/login", { body });
        responses.push(response);
      }

      for (const response of responses) {
        assert.equal(response.status, 401);
        assert.match(response.text, /Invalid email or password/);
        assert.doesNotMatch(response.text, /blocked/i);
        assert.doesNotMatch(response.text, /nobody@example\.invalid/);
      }
    });
  });

  it("locks the account after repeated failures and unlocks after a success", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "login.lock@example.invalid" });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failure = await send(server, "/user/login", {
          body: { email: user.email, password: "WrongPassw0rd!" },
        });
        assert.equal(failure.status, 401);
      }

      const locked = await User.findById(user._id).lean();
      assert.ok(locked.loginLockedUntil.getTime() > Date.now());

      const blockedByLock = await send(server, "/user/login", {
        body: { email: user.email, password: "TestPassw0rd!" },
      });
      assert.equal(blockedByLock.status, 401);

      await User.updateOne(
        { _id: user._id },
        { $set: { loginLockedUntil: null, loginAttempts: 0 } },
      );

      const success = await send(server, "/user/login", {
        body: { email: user.email, password: "TestPassw0rd!" },
      });
      assert.equal(success.location, "/");

      const payload = await send(server, "/user/session", {
        method: "GET",
        cookie: success.cookie,
      });
      assert.match(payload.text, new RegExp(user._id.toString()));

      const stored = await User.findById(user._id).lean();
      assert.equal(stored.loginAttempts, 0);
      assert.equal(stored.loginLockedUntil, null);
      assert.ok(stored.lastLoginAt);
    });
  });

  it("rotates the session identifier on login", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "login.rotate@example.invalid" });

      const first = await send(server, "/user/login", {
        body: { email: user.email, password: "TestPassw0rd!" },
      });
      assert.equal(first.location, "/");
      assert.ok(first.cookie);

      const second = await send(server, "/user/login", {
        body: { email: user.email, password: "TestPassw0rd!" },
        cookie: first.cookie,
      });
      assert.equal(second.location, "/");
      assert.ok(second.cookie);
      assert.notEqual(
        second.cookie,
        first.cookie,
        "logging in again must issue a new session identifier",
      );
    });
  });
});

describe("password reset", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (reachable) {
      server = await startServer();
    }
  });

  after(async () => {
    if (server) {
      await server.close();
    }
  });

  const withDatabase = (run) => (reachable ? withTestDatabase(run) : null);

  const requestReset = async (email) => {
    sentMail.length = 0;
    const response = await send(server, "/user/forgot-password", {
      body: { email },
    });
    return {
      response,
      mail: sentMail.at(-1),
      token: /token=([a-f0-9]{64})/.exec(sentMail.at(-1)?.text ?? "")?.[1],
    };
  };

  it("answers the same way for a known and an unknown address", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      await createUser({ email: "reset.known@example.invalid" });

      const known = await requestReset("reset.known@example.invalid");
      const unknown = await requestReset("reset.unknown@example.invalid");

      assert.equal(known.response.status, 200);
      assert.equal(unknown.response.status, 200);
      assert.equal(known.response.text, unknown.response.text);
      assert.match(known.response.text, /If an account exists/);
      assert.equal(unknown.mail, undefined, "no mail for an unknown address");

      const unknownUser = await User.findOne({
        email: "reset.unknown@example.invalid",
      });
      assert.equal(unknownUser, null);
    });
  });

  it("stores only the hash of the reset token and emails the raw token", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "reset.hash@example.invalid" });
      const { token } = await requestReset(user.email);
      assert.match(token, /^[a-f0-9]{64}$/);

      const stored = await User.findById(user._id).lean();
      assert.equal(stored.resetPasswordTokenHash, hashToken(token));
      assert.notEqual(stored.resetPasswordTokenHash, token);
      assert.ok(stored.resetPasswordExpires.getTime() > Date.now());
      assert.equal(stored.resetPasswordUsedAt, null);
    });
  });

  it("resets the password once and invalidates the token afterwards", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "reset.once@example.invalid" });
      const { token } = await requestReset(user.email);

      const success = await send(server, "/user/reset-password", {
        body: {
          token,
          newPassword: "NewPassw0rd!",
          confirmPassword: "NewPassw0rd!",
        },
      });
      assert.equal(success.location, "/user/login?reset=1");

      const stored = await User.findById(user._id).lean();
      assert.match(stored.password, /^\$2[aby]\$12\$/);
      assert.equal(stored.resetPasswordTokenHash, null);
      assert.ok(stored.resetPasswordUsedAt);

      const reused = await send(server, "/user/reset-password", {
        body: {
          token,
          newPassword: "AnotherPassw0rd!",
          confirmPassword: "AnotherPassw0rd!",
        },
      });
      assert.equal(reused.status, 200);
      assert.match(reused.text, /invalid or has expired/);
    });
  });

  it("refuses unknown, mismatched and expired tokens", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "reset.guard@example.invalid" });
      const { token } = await requestReset(user.email);

      const unknownToken = await send(server, "/user/reset-password", {
        body: {
          token: "f".repeat(64),
          newPassword: "NewPassw0rd!",
          confirmPassword: "NewPassw0rd!",
        },
      });
      assert.match(unknownToken.text, /invalid or has expired/);

      const missingToken = await send(server, "/user/reset-password", {
        body: {
          newPassword: "NewPassw0rd!",
          confirmPassword: "NewPassw0rd!",
        },
      });
      assert.match(missingToken.text, /invalid or has expired/);

      await User.updateOne(
        { _id: user._id },
        { $set: { resetPasswordExpires: new Date(Date.now() - 1000) } },
      );
      const expired = await send(server, "/user/reset-password", {
        body: {
          token,
          newPassword: "NewPassw0rd!",
          confirmPassword: "NewPassw0rd!",
        },
      });
      assert.match(expired.text, /invalid or has expired/);

      const unchanged = await User.findById(user._id).lean();
      assert.doesNotMatch(unchanged.password, /^\$2[aby]\$12\$$/);
      assert.equal(
        unchanged.resetPasswordTokenHash,
        hashToken(token),
        "a refused reset must leave the token untouched",
      );
    });
  });

  it("refuses a weak password and a mismatch", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "reset.weak@example.invalid" });
      const { token } = await requestReset(user.email);

      const weak = await send(server, "/user/reset-password", {
        body: { token, newPassword: "short", confirmPassword: "short" },
      });
      assert.match(weak.text, /at least 8 characters/);

      const mismatch = await send(server, "/user/reset-password", {
        body: {
          token,
          newPassword: "NewPassw0rd!",
          confirmPassword: "DifferentPassw0rd!",
        },
      });
      assert.match(mismatch.text, /Passwords do not match/);

      const stored = await User.findById(user._id).lean();
      assert.equal(stored.resetPasswordTokenHash, hashToken(token));
    });
  });

  it("rate limits reset requests per account", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    await withDatabase(async () => {
      const user = await createUser({ email: "reset.throttle@example.invalid" });
      await requestReset(user.email);
      const first = await User.findById(user._id).lean();

      const second = await requestReset(user.email);
      assert.equal(second.response.status, 200);
      const after = await User.findById(user._id).lean();
      assert.equal(
        after.resetPasswordTokenHash,
        first.resetPasswordTokenHash,
        "a throttled request must not rotate the token",
      );
    });
  });
});

after(async () => {
  await closeGlobalSessionStore();
});

// The signup page and the signup handler both decide whether a password and a
// mobile number are acceptable. They used to disagree: the page's regular
// expression wanted letters and digits and nothing else, so a password like
// `ryhua10@Toyhub` was refused by the browser and never reached the handler that
// would have accepted it, and the message named a rule the reader had not been
// told about.
//
// Both sides are handed one rule now, and this asks both of them about the same
// passwords and the same numbers. The page's copy is the script the server
// actually hands the browser, read out of the page that uses it, so a rule that
// starts drifting apart again fails here rather than in a person's browser.
describe("the signup page and the signup handler agree on what a password is", () => {
  const pageScript = (view) =>
    readFileSync(
      path.join(viewsDirectory, view),
      "utf8",
    );

  // Runs the rule the server hands the browser, and returns what the browser
  // would answer for each value.
  const asTheBrowserSeesIt = () => {
    const sandbox = { window: {} };
    runInNewContext(passwordPolicyScript(), sandbox);
    return sandbox.window.toyhubPasswordPolicy;
  };

  const asTheBrowserSeesAPhone = () => {
    const sandbox = { window: {} };
    runInNewContext(phonePolicyScript(), sandbox);
    return sandbox.window.toyhubPhonePolicy;
  };

  // The passwords and numbers a person actually types, rather than a rule
  // restated: the ones that matter here are the ones with a symbol in them.
  const passwords = [
    "ryhua10@Toyhub",
    "Toyhub10!",
    "correct horse battery",
    "p@ssw0rd.with.dots",
    "a1!@#$%^&*",
    "1234567890123456",
    "Toyhub10",
    "abcdefghij",
    "12345678",
    "short1",
    "",
    "        ",
  ];

  const phones = [
    "9876543210",
    "98765 43210",
    "98765-43210",
    "+91 98765 43210",
    "(98765) 43210",
    "  9876543210  ",
    "12345",
    "987654321012345",
    "9876543210123456",
    "not a number",
    "",
  ];

  it("judges every password the same way on both sides", () => {
    const browser = asTheBrowserSeesIt();

    for (const password of passwords) {
      assert.equal(
        browser.isStrong(password),
        isStrongPassword(password),
        `the page and the handler should agree about ${JSON.stringify(password)}`,
      );
    }
  });

  it("judges every mobile number the same way on both sides", () => {
    const browser = asTheBrowserSeesAPhone();

    for (const phone of phones) {
      assert.equal(
        browser.isValid(phone),
        isValidPhoneNumber(phone),
        `the page and the handler should agree about ${JSON.stringify(phone)}`,
      );
      assert.equal(
        browser.normalize(phone),
        normalizePhoneNumber(phone),
        `and should write it the same way: ${JSON.stringify(phone)}`,
      );
    }
  });

  it("accepts the password that was refused, rather than only saying it should be", () => {
    // The one that started this: a real password with a symbol in it.
    assert.equal(
      isStrongPassword("ryhua10@Toyhub"),
      true,
      "a symbol is not a reason to refuse a password",
    );
  });

  it("is asked about the password before it is sent, using the rule it was given", () => {
    // The page must not have quietly kept a rule of its own.
    for (const view of ["user/signup.ejs", "user/resend-otp.ejs"]) {
      const page = pageScript(view);
      assert.doesNotMatch(
        page,
        /\[A-Za-z\\d\]\{8,\}/,
        `${view} must not carry its own password rule; it is given the server's`,
      );
      assert.match(page, /toyhubPasswordPolicy/, `${view} should use the rule the server hands it`);
    }
  });

  it("says the rule it is enforcing", () => {
    const page = pageScript("user/signup.ejs");

    // A message that names a rule the reader was not given is worse than no
    // message, because it sends them looking for a rule that is not there.
    assert.doesNotMatch(page, /Invalid phone number format/);
    assert.match(page, /toyhubPhonePolicy/, "and the phone rule is the server's too");
  });

  it("keeps the password out of the server's logs", () => {
    // `isStrongPassword` used to `console.log` the password it was checking.
    const source = readFileSync(
      path.join(viewsDirectory, "..", "controllers", "userModules", "auth.js"),
      "utf8",
    );
    assert.doesNotMatch(source, /console\.log\(\s*["']?password/i);
  });
});
