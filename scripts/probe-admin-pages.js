// Visits every page an administrator can reach and reports what breaks.
//
// The point is to read the answers rather than assume them: a page that returns
// 200 with an error message inside it is broken too, and so is one whose html is
// a 404 or a stack trace. So each page is checked for what it should contain, not
// only for its status.
import { setMailTransport } from "../utils/mailer.js";
import { readEnv } from "../utils/config.js";

setMailTransport({ sendMail: async () => {} });

// server.js listens on PORT itself, and 3000 usually belongs to the developer's
// own server. It has to be asked for after PORT is set rather than imported at
// the top: an import is evaluated before any of this file's own statements, so a
// top-level import would bind 3000 whatever this said.
const port = Number(readEnv("PROBE_PORT") || "3599");
process.env.PORT = String(port);

const { default: AdminUser } = await import("../models/admin.models.js");
const { default: Product } = await import("../models/product.models.js");
const { default: User } = await import("../models/users.models.js");
const { hashPassword } = await import("../utils/auth-tokens.js");
const { ensureBootstrapAdmin } = await import("../controllers/adminModules/login.js");
await import("../server.js");

const base = `http://127.0.0.1:${port}`;
const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      await fetch(`${base}/admin/login`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return false;
};

if (!(await waitForServer())) {
  console.error("the app never came up");
  process.exit(1);
}

const ADMIN_EMAIL = readEnv("ADMIN_EMAIL") || "probe-admin@example.invalid";
const ADMIN_PASSWORD = readEnv("ADMIN_PASSWORD") || "ProbeAdmin123!";

// Makes sure there is an administrator to be, and one product for the pages that
// need something to show.
await ensureBootstrapAdmin();
const admin = await AdminUser.findOneAndUpdate(
  { email: ADMIN_EMAIL },
  { $set: { isActive: true, role: "superadmin", password: await hashPassword(ADMIN_PASSWORD) } },
  { new: true, upsert: true },
);

let productId = (await Product.findOne({}))?.id ?? null;
if (!productId) {
  const created = await Product.create({
    name: "Probe Widget",
    description: "A thing for the probe to find.",
    price: 499,
    stock: 7,
    category: new (await import("mongoose")).Types.ObjectId(),
    images: [],
  });
  productId = created.id;
}
// Records the actions can act on. Built with the same helpers the tests use, so
// they are records the application would accept rather than ones shaped to get
// past a check.
const { default: fixtures } = await import("../test/helpers/fixtures.js");
const categoryName = `Probe Category ${Date.now().toString(36)}`;
const categoryId = (await fixtures.createCategory({ name: categoryName }))._id;
// A second category, so that "that name is taken" can be asked for honestly: after
// the edit below renames the first, the name it started with is free again, and a
// duplicate check tested against that would pass for the wrong reason.
const otherCategoryId = (await fixtures.createCategory({ name: `${categoryName} Two` }))._id;
void otherCategoryId;
const shopperId = (await fixtures.createUser({ email: `probe-user-${Date.now().toString(36)}@example.invalid` }))._id;
const orderId = (await fixtures.createOrder())._id;

// A cookie-keeping caller, which is all a browser is.
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

const request = async (pathname, { form, method } = {}) => {
  const headers = {};
  if (jar.size > 0) headers.cookie = cookieHeader();
  let body;
  const verb = method ?? (form ? "POST" : "GET");
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  const response = await fetch(`${base}${pathname}`, { method: verb, headers, body, redirect: "manual" });
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
  }
  const text = await response.text();
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    text,
  };
};

const loginPage = await request("/admin/login");
const token = loginPage.text.match(/name="_csrf" value="([^"]+)"/)?.[1];
const login = await request("/admin/login", {
  form: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, _csrf: token },
});
console.log(`admin login: ${login.status} -> ${login.location}\n`);
if (login.status !== 302) {
  console.log("could not sign in as an administrator, so nothing else can be checked");
  process.exit(1);
}

// A page asked for something that is not there should say so. So for those the
// question is not "was it 200" but "did it answer properly": a real page in the
// application's own words, rather than a missing-view error or a stack trace.
// `missingId` is shaped like an id but belongs to nothing.
const missingId = "000000000000000000000000";

// name, path, and whether the page is expected to refuse because there is
// nothing at that id.
const pages = [
  ["dashboard", "/admin", false],
  ["products", "/admin/products", false],
  ["add product", "/admin/addProduct", false],
  ["edit product", `/admin/editProduct/${productId}`, false],
  ["categories", "/admin/category", false],
  ["edit category", `/admin/category/edit/${missingId}`, true],
  ["users", "/admin/users", false],
  ["orders", "/admin/orders", false],
  ["order details", `/admin/orders/view/${missingId}`, true],
  ["coupons", "/admin/coupons", false],
  ["add coupon", "/admin/addCoupon", false],
  ["offers", "/admin/offers", false],
  ["add offer", "/admin/addOffer", false],
  ["sales report", "/admin/salesReport", false],
  ["weekly sales", "/admin/sales/weekly", false],
  ["monthly sales", "/admin/sales/monthly", false],
  ["yearly sales", "/admin/sales/yearly", false],
];

// Signs of a page that failed while being built: the error text node, or a view
// that was never found.
const failureMarks = [
  [/Failed to lookup view/i, "the page it tries to show does not exist"],
  [/is not defined/, "a variable the page uses does not exist"],
  [/is not a function/, "something the page calls is not callable"],
  [/Cannot read propert/i, "the page read a property of nothing"],
  [/ENOENT/, "a file the page needs is missing"],
  [/<pre>[\s\S]*?Error/, "a stack trace rendered into the page"],
  [/Rendered.*does not exist/i, "the page was never found"],
];

const failures = [];

for (const [name, path, expectedToRefuse] of pages) {
  const response = await request(path);

  const problems = [];

  if (expectedToRefuse) {
    // Nothing is at that id, so refusing is right. Answering with a crash is not.
    if (response.status !== 404) {
      problems.push(`should refuse a missing record, but answered ${response.status}`);
    }
    if (!/Something went wrong|not found|Could not GET/i.test(response.text)) {
      problems.push("refused, but not in words a person can read");
    }
  } else if (response.status >= 400) {
    problems.push(`status ${response.status}`);
  }
  for (const [pattern, why] of failureMarks) {
    const match = response.text.match(pattern);
    if (match) {
      const at = response.text.indexOf(match[0]);
      const around = response.text
        .slice(Math.max(0, at - 90), at + 90)
        .replace(/\s+/g, " ")
        .trim();
      problems.push(`${why}: ...${around}...`);
    }
  }
  // A page whose only script threw leaves its own buttons dead. Asking whether the
  // There used to be a check here that ran each page's inline script in a bare
  // sandbox. It could never fail: every one of these scripts reaches for the
  // document, so every one of them threw, and every throw was caught and treated as
  // nothing to do with the question. It read like coverage of dead buttons and
  // covered none. Whether a page's own script runs is asked properly by
  // walk-signup-flow.js, against the html the server really sent.
  if (problems.length === 0) {
    console.log(`  pass  ${name.padEnd(15)} ${path}`);
  } else {
    console.log(`  FAIL  ${name.padEnd(15)} ${path}`);
    for (const problem of problems) {
      console.log(`          ${problem}`);
    }
    failures.push({ name, path, problems });
  }
}

// A page that loads is only half of a feature. The rest is what its buttons do,
// so those are asked here too, against records that really exist rather than ids
// that belong to nothing.
// name, path, the form to post, the method, and the answer it should give.
//
// The answer is named rather than assumed, because "did not return 500" is not the
// same question as "did what it was asked to do". Refusing an empty name with a
// 400 is the correct answer and must not be read as a failure; a 403 is the
// opposite, because it means the handler was never reached at all.
//
// The two exports are downloads, so a browser asks for them with a GET rather than
// posting a form.
const actions = [
  ["block a product", "/admin/blockProduct/" + productId, {}, "POST", 302],
  ["unblock it again", "/admin/blockProduct/" + productId, {}, "POST", 302],
  ["add a category", "/admin/category", { name: `Probe Added ${Date.now().toString(36)}` }, "POST", 302],
  ["refuse an empty new category name", "/admin/category", {}, "POST", 400],
  ["refuse an empty category name", `/admin/category/edit/${categoryId}`, {}, "POST", 400],
  ["refuse a name already taken", `/admin/category/edit/${categoryId}`, { name: `${categoryName} Two` }, "POST", 400],
  ["refuse a name that is only too short", `/admin/category/edit/${categoryId}`, { name: "ab" }, "POST", 400],
  ["save a category edit", `/admin/category/edit/${categoryId}`, { name: `Renamed ${categoryId.toString().slice(-5)}` }, "POST", 302],
  ["hide a category", `/admin/category/delete/${categoryId}`, {}, "POST", 302],
  ["show it again", `/admin/category/delete/${categoryId}`, {}, "POST", 302],
  ["block a user", `/admin/blockUser/${shopperId}`, {}, "POST", 302],
  ["unblock them", `/admin/blockUser/${shopperId}`, {}, "POST", 302],
  ["move an order on", `/admin/orders/updateStatus/${orderId}`, { status: "shipped" }, "POST", 200],
  ["move it on again", `/admin/orders/updateStatus/${orderId}`, { status: "delivered" }, "POST", 200],
  ["export the sales report", "/admin/salesReport/export", null, "GET", 200],
  ["export it as a pdf", "/admin/salesReport/export-pdf", null, "GET", 200],
];

// The token belongs to the session rather than to any one page, so it is read
// once from the dashboard and kept. Asking an action for its own url instead would
// mean asking a post-only route with a GET, which answers 404 and is not where a
// token lives; and reading it from whichever page happened to be read last is how
// a later action quietly ends up testing nothing at all.
const dashboard = (await request("/admin")).text;
const csrf = dashboard.match(/name="_csrf" value="([^"]+)"/)?.[1];
if (!csrf) {
  console.log("could not find a csrf token, so no action could be tested");
  process.exit(1);
}

for (const [name, path, form, method, expected] of actions) {
  const response =
    method === "GET"
      ? await request(path)
      : await request(path, { form: { ...form, _csrf: csrf } });

  const problems = [];

  if (response.status !== expected) {
    problems.push(`answered ${response.status}, which is not the ${expected} this action should give`);
  }
  if (response.status >= 500) {
    problems.push(`status ${response.status}`);
  }
  for (const [pattern, why] of failureMarks) {
    const match = response.text.match(pattern);
    if (match) {
      problems.push(`${why}: ...${response.text.slice(Math.max(0, response.text.indexOf(match[0]) - 70), response.text.indexOf(match[0]) + 70).replace(/\s+/g, " ")}...`);
    }
  }

  // A 403 means the request never reached the handler, so counting it as working
  // would mean this action was never actually tested.
  if (response.status === 403) {
    problems.push("refused by csrf, so the action itself was never reached");
  }

  if (problems.length === 0) {
    console.log(`  pass  ${name.padEnd(24)} ${response.status}`);
  } else {
    console.log(`  FAIL  ${name.padEnd(24)} ${response.status}`);
    for (const problem of problems) {
      console.log(`          ${problem}`);
    }
    failures.push({ name, path, problems });
  }
}

console.log(
  failures.length === 0
    ? `\nall ${pages.length} admin pages answered, and all ${actions.length} admin actions worked`
    : `\n${pages.length + actions.length - failures.length} of ${pages.length + actions.length} admin pages and actions worked; ${failures.length} failed`,
);
process.exit(failures.length === 0 ? 0 : 1);
