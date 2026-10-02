// Walks the flow a person actually walks, against the real app: real routes, real
// session, real database, real CSRF token, with the email captured instead of sent.
//
// Not a test file. This is here to be read while trying the app, because the bug
// it was written for was only ever visible in a browser: the signup page refused a
// password the server would have accepted, so nothing downstream ever ran.
import { setMailTransport } from "../utils/mailer.js";
import { readEnv } from "../utils/config.js";
import { runInNewContext } from "node:vm";

const mail = [];
setMailTransport({
  sendMail: async (message) => {
    mail.push(message);
  },
});

// server.js listens on PORT itself, and 3000 is usually taken by the dev server
// the person running this is already looking at, so this asks for its own port
// rather than fighting for that one.
const port = Number(readEnv("WALK_PORT") || "3457");
process.env.PORT = String(port);

await import("../server.js");

// Wait for the app to come up, the same way waiting for it by hand would.
const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    await fetch(`${base}/user/signup`);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const jars = new Map();
let step = 0;
const say = (line = "") => console.log(line);
const heading = (title) => say(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);

// Keeps cookies per caller, the way a browser does.
class Browser {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }

  cookieHeader() {
    return [...this.jar].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  async request(pathname, { form } = {}) {
    const headers = {};
    if (this.jar.size > 0) {
      headers.cookie = this.cookieHeader();
    }

    let body;
    if (form) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }

    const response = await fetch(`${base}${pathname}`, {
      method: form ? "POST" : "GET",
      headers,
      body,
      redirect: "manual",
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      this.jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
    }

    return {
      status: response.status,
      location: response.headers.get("location"),
      text: await response.text(),
    };
  }

  // Pulls the CSRF token out of a rendered page, exactly as the page's own script
  // does, and posts it back the way a browser submitting the form would.
  async submit(pathname, form) {
    const token = this.token();
    if (!token) {
      throw new Error(`no csrf token was exposed to ${pathname}`);
    }
    return this.request(pathname, { form: { ...form, _csrf: token } });
  }

  token() {
    const html = this.lastPage ?? "";
    return html.match(/name="csrf-token" content="([^"]+)"/)?.[1]
      ?? html.match(/name="_csrf" value="([^"]+)"/)?.[1]
      ?? null;
  }
}

const browser = new Browser("person");
const visit = async (pathname) => {
  const response = await browser.request(pathname);
  browser.lastPage = response.text;
  return response;
};

const results = [];
  // Run the page's own inline scripts and see what they leave behind on window.
//
// Looking for the text `window.toyhubPhonePolicy =` is not the same question.
// The rule was once emitted straight into the page body, outside any <script>
// element: the text was there, so a test looking for the text passed, and the
// browser printed it as a paragraph and left the global undefined. What matters
// is what running the page leaves on window, so that is what is asked here.
const runInlineScripts = (html) => {
  const sandbox = { window: {} };
  for (const [, body] of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      runInNewContext(body, sandbox);
    } catch {
      // A script that needs the document is not this one's job to run.
    }
  }
  return sandbox.window;
};


const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  say(`  ${ok ? "pass" : "FAIL"}  ${label}${detail ? `\n          ${detail}` : ""}`);
};

const PASSWORD = readEnv("WALK_PASSWORD") || "ryhua10@Toyhub";
const NAME = readEnv("WALK_NAME") || "Walk Through";
const PHONE = readEnv("WALK_PHONE") || "98765 43210";
// A new address every run, so this can be walked as many times as it takes. A
// walkthrough you can only run once is a test that tells you nothing the second
// time you need it.
const EMAIL =
  readEnv("WALK_EMAIL")
  || `walkthrough-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;

heading("1. the signup page as a browser receives it");
{
  const response = await visit("/user/signup");
  check("page is served", response.status === 200, `status ${response.status}`);
  const page = response.text;

  const fromTheBrowser = runInlineScripts(page);

  check(
    "running the page's scripts defines the password rule",
    typeof fromTheBrowser.toyhubPasswordPolicy?.isStrong === "function",
    "the rule is emitted, but not inside a <script> element, so the browser never runs it",
  );
  check(
    "and it is the rule the server has",
    fromTheBrowser.toyhubPasswordPolicy?.isStrong?.("ryhua10@Toyhub") === true
      && fromTheBrowser.toyhubPasswordPolicy?.isStrong?.("short1") === false,
    "the page should accept a password with a symbol and refuse a short one",
  );
  check(
    "running the page's scripts defines the phone rule",
    typeof fromTheBrowser.toyhubPhonePolicy?.isValid === "function",
    "same thing: emitted, but not run",
  );
  check(
    "and it accepts a number written the way numbers are written",
    fromTheBrowser.toyhubPhonePolicy?.isValid?.("98765 43210") === true
      && fromTheBrowser.toyhubPhonePolicy?.isValid?.("12345") === false,
    String(fromTheBrowser.toyhubPhonePolicy?.normalize?.("98765 43210")),
  );
  check(
    "the page no longer carries a password rule of its own",
    !/\[A-Za-z\\d\]\{8,\}/.test(page),
    "the old letters-and-digits-only expression",
  );
  check("there is a csrf token to post back", Boolean(page.match(/name="_csrf" value="[^"]+"/)));
}

heading(`2. signup with a password containing a symbol: ${JSON.stringify(PASSWORD)}`);
{
  const weak = await browser.submit("/user/signup", {
    name: NAME,
    email: EMAIL,
    phone_number: PHONE,
    password: "short1",
    confirmPassword: "short1",
  });
  browser.lastPage = weak.text;
  check(
    "a weak password is refused, with the rule stated",
    weak.status === 400 && /at least 8 characters/.test(weak.text),
    weak.text.match(/Password must be[^<"]*/)?.[0] ?? `status ${weak.status}`,
  );

  const mismatch = await browser.submit("/user/signup", {
    name: NAME,
    email: EMAIL,
    phone_number: PHONE,
    password: PASSWORD,
    confirmPassword: `${PASSWORD}x`,
  });
  browser.lastPage = mismatch.text;
  check("a mismatch is refused", mismatch.status === 400 && /do not match/i.test(mismatch.text));

  const response = await browser.submit("/user/signup", {
    name: NAME,
    email: EMAIL,
    phone_number: PHONE,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  check(
    "the password with a symbol is accepted",
    response.status === 302 && response.location === "/user/otp",
    `status ${response.status} -> ${response.location ?? "(no redirect)"}`,
  );
  check("an email carrying the otp was sent", mail.length === 1, mail.at(-1)?.subject ?? "none sent");
}

heading("3. what was written to the database");
{
  const { default: User } = await import("../models/users.models.js");
  const user = await User.findOne({ email: EMAIL }).lean();
  check("the account exists", Boolean(user));
  check("the number was stored as the number, not as it was typed", user?.phone_number === "9876543210", `stored ${JSON.stringify(user?.phone_number)} from ${JSON.stringify(PHONE)}`);
  check("the password is not stored in the clear", Boolean(user?.password) && !user.password.includes(PASSWORD), user?.password?.slice(0, 12) + "...");
  check("the account starts unverified", user?.verified === false);
  check("the account is not blocked", user?.isBlocked !== true);
}

heading("4. the otp page, and a wrong code");
{
  const response = await visit("/user/otp");
  check("the otp page is served to the new account", response.status === 200, `status ${response.status}`);

  const wrong = await browser.submit("/user/otp", { otp1: "0", otp2: "0", otp3: "0", otp4: "0", otp5: "0", otp6: "0" });
  browser.lastPage = wrong.text;
  check(
    "a wrong code is refused without saying which part was wrong",
    wrong.status === 400 && !/incorrect|invalid|wrong/i.test(wrong.text),
    wrong.text.match(/<p class="[^"]*error[^"]*"[^>]*>([^<]*)</)?.[1] ?? `status ${wrong.status}`,
  );

  // Asking for another code changes the account's pending code, so it is a POST
  // with the session token. A GET is refused, because the CSRF check lets GETs
  // through and this is a change.
  const resendByLink = await visit("/user/resend-otp");
  check(
    "a plain link cannot ask for another code",
    resendByLink.status !== 200 && resendByLink.status !== 302,
    `a GET to /user/resend-otp answered ${resendByLink.status}`,
  );

  const resent = await browser.submit("/user/resend-otp", {});
  check(
    "a new code can be asked for with the session token",
    resent.status === 200 || resent.status === 429,
    `status ${resent.status}`,
  );
}

heading("5. the real code, read out of the email");
{
  const code = mail.at(-1)?.text?.match(/\b(\d{6})\b/)?.[1];
  check("the email contains a six digit code", Boolean(code), code ?? mail.at(-1)?.text?.slice(0, 120));

  const digits = code.split("");
  const response = await browser.submit("/user/otp", {
    otp1: digits[0], otp2: digits[1], otp3: digits[2],
    otp4: digits[3], otp5: digits[4], otp6: digits[5],
  });
  check(
    "the correct code verifies the account and sends you to login",
    response.status === 302 && response.location === "/user/login",
    `status ${response.status} -> ${response.location ?? "(no redirect)"}`,
  );

  const { default: User } = await import("../models/users.models.js");
  const user = await User.findOne({ email: EMAIL }).lean();
  check("the account is now verified", user?.verified === true);
  check("the spent code was cleared", user?.otpHash === null && user?.otpExpires === null);
}

heading("6. logging in");
{
  const page = await visit("/user/login");
  check("the login page is served", page.status === 200, `status ${page.status}`);

  const wrong = await browser.submit("/user/login", { email: EMAIL, password: "not-the-password" });
  browser.lastPage = wrong.text;
  check("a wrong password is refused", wrong.status === 401, `status ${wrong.status}`);
  check("the refusal does not reveal whether the account exists", !new RegExp(EMAIL, "i").test(wrong.text.match(/alert|error|message/gi) ? wrong.text : ""));

  const response = await browser.submit("/user/login", { email: EMAIL, password: PASSWORD });
  check(
    "the password with a symbol is accepted at login",
    response.status === 302 && response.location === "/",
    `status ${response.status} -> ${response.location ?? "(no redirect)"}`,
  );

  const { default: User } = await import("../models/users.models.js");
  const user = await User.findOne({ email: EMAIL }).lean();
  check("the login was recorded", Boolean(user?.lastLoginAt), String(user?.lastLoginAt));
}

heading("7. the session, and the page that needs one");
{
  const page = await visit("/account");
  check("a signed in person reaches a page that needs a session", page.status === 200, `status ${page.status}`);
  check("the page knows who is signed in", page.text.includes(NAME));

  // Logout is a POST carrying the session token, so a page on the internet
  // cannot log anybody out by linking to it. A GET is refused, which is the
  // point of the change.
  const byLink = await visit("/user/logout");
  check(
    "a plain link cannot log anybody out",
    byLink.status !== 302,
    `a GET to /user/logout answered ${byLink.status}`,
  );

  const response = await browser.submit("/user/logout", {});
  check(
    "logout redirects to login",
    response.status === 302 && response.location === "/user/login",
    `status ${response.status} -> ${response.location}`,
  );

  const after = await visit("/account");
  check("the session is gone afterwards", /login|sign in/i.test(after.text) && after.status !== 500, `status ${after.status}`);
}

heading("8. forgetting the password with the same symbol-bearing password");
{
  const stranger = new Browser("stranger");
  await stranger.request("/user/forgot-password");
  stranger.lastPage = await stranger.request("/user/forgot-password").then((r) => r.text);
  const response = await stranger.submit("/user/forgot-password", { email: EMAIL });
  // Always 200, whatever the address: a reset page that said "no such account"
  // would answer the question it is supposed to keep private.
  stranger.lastPage = response.text;
  check(
    "a reset request is taken, without saying whether the account exists",
    response.status === 200 && /on its way/i.test(response.text),
    `status ${response.status}`,
  );

  const unknown = new Browser("unknown");
  unknown.lastPage = (await unknown.request("/user/forgot-password")).text;
  const unknownResponse = await unknown.submit("/user/forgot-password", { email: "nobody@example.invalid" });
  unknown.lastPage = unknownResponse.text;
  // Compared on the message a person would read, not on the whole page: every
  // page carries this browser's own csrf token, so the markup is never identical
  // between two sessions and comparing all of it would prove nothing.
  const shownMessage = (html) =>
    html.match(/on its way[^<"]*/i)?.[0]?.trim() ?? html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  check(
    "an address with no account gets the same answer as one that does",
    shownMessage(unknownResponse.text) === shownMessage(response.text),
    `with account: "${shownMessage(response.text)}"\n          without:    "${shownMessage(unknownResponse.text)}"`,
  );

  const token = mail.at(-1)?.text?.match(/https?:\/\/\S+/)?.[0]?.match(/token=([^\s&]+)/)?.[1];
  check("the reset email carries a link with a token", Boolean(token), token ?? mail.at(-1)?.text?.slice(0, 160));

  // The reset page refuses passwords in the browser too, and it had the same
  // fault: the rule was emitted outside a <script> element, so it never ran.
  const resetPage = await stranger.request("/user/reset-password?token=" + encodeURIComponent(token ?? "x"));
  stranger.lastPage = resetPage.text;
  const resetWindow = runInlineScripts(resetPage.text);
  check(
    "the reset page's rules actually run",
    typeof resetWindow.toyhubPasswordPolicy?.isStrong === "function",
    "emitted, but not inside a <script> element, so the browser never runs it",
  );
  check(
    "and the reset page accepts a password with a symbol",
    resetWindow.toyhubPasswordPolicy?.isStrong?.("BrandNewPassw0rd!") === true,
  );

  const resetUrl = "/user/reset-password?token=" + encodeURIComponent(token ?? "x");

  stranger.lastPage = (await stranger.request(resetUrl)).text;
  const weak = await stranger.submit(resetUrl, {
    token,
    newPassword: "short1",
    confirmPassword: "short1",
  });
  stranger.lastPage = weak.text;
  check(
    "a weak new password is refused at reset, with the rule stated",
    /at least 8 characters/.test(weak.text),
    weak.text.match(/Password must be[^<"]*/)?.[0] ?? "no message",
  );

  stranger.lastPage = (await stranger.request(resetUrl)).text;
  const mismatch = await stranger.submit(resetUrl, {
    token,
    newPassword: "BrandNewPassw0rd!",
    confirmPassword: "SomethingElse0!",
  });
  stranger.lastPage = mismatch.text;
  check("a mismatch is refused at reset", /do not match/i.test(mismatch.text));

  stranger.lastPage = (await stranger.request(resetUrl)).text;
  const strong = await stranger.submit(resetUrl, {
    token,
    newPassword: "BrandNewPassw0rd!",
    confirmPassword: "BrandNewPassw0rd!",
  });
  check(
    "a password with a symbol is accepted at reset",
    strong.status === 302 && strong.location?.startsWith("/user/login"),
    `status ${strong.status} -> ${strong.location ?? "(no redirect)"}`,
  );

  const after = new Browser("after-reset");
  after.lastPage = (await after.request("/user/login")).text;
  const login = await after.submit("/user/login", { email: EMAIL, password: "BrandNewPassw0rd!" });
  check("the new password is the one that logs in", login.status === 302 && login.location === "/", `status ${login.status} -> ${login.location}`);
}

heading("the flow, in one line");
const failed = results.filter((r) => !r.ok);
say(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${results.length - failed.length} of ${results.length} checks passed; ${failed.length} failed`,
);
say("");

process.exit(failed.length === 0 ? 0 : 1);
