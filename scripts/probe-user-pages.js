// Visits every page a shopper can reach and reports what breaks.
//
// This is the same bargain as probe-admin-pages.js: read the answers rather than
// assume them, because a page that answers 200 with an error inside it is broken
// too. What makes it worth having is the data it asks with.
//
// Every reference in the shop is a thing that can be deleted while something
// still points at it — a product whose category is gone, an order whose customer
// is gone, a wishlist entry for a product that was taken down. Those are ordinary
// states, produced by ordinary deletions, and a page that reads straight through
// one of them ends. So this seeds them on purpose and asks for every page.
import { setMailTransport } from "../utils/mailer.js";
import { readEnv } from "../utils/config.js";

setMailTransport({ sendMail: async () => {} });

// server.js listens on PORT itself, and 3000 usually belongs to the developer's
// own server. It has to be asked for after PORT is set rather than imported at
// the top: an import is evaluated before any of this file's own statements.
const port = Number(readEnv("PROBE_PORT") || "3699");
process.env.PORT = String(port);

const mongoose = (await import("mongoose")).default;
const { default: Product } = await import("../models/product.models.js");
const { default: User } = await import("../models/users.models.js");
const { default: Category } = await import("../models/categories.model.js");
const { default: Order } = await import("../models/orders.models.js");
const { default: Wishlist } = await import("../models/wishlist.models.js");
const { hashPassword } = await import("../utils/auth-tokens.js");
const fixtures = (await import("../test/helpers/fixtures.js")).fixtures;
await import("../server.js");

const base = `http://127.0.0.1:${port}`;
const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      await fetch(`${base}/`);
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

const stamp = Date.now().toString(36);
const shopperEmail = `probe-shopper-${stamp}@example.invalid`;
const shopperPassword = "ProbeShopper123!";

// A shopper with the broken references already in place, so that the pages which
// read through them are asked with them rather than described as possibly having
// them. Seeded before the account signs in so the pages that need a session see
// the same rows an ordinary shopper would have left behind.
const orphanCategory = new mongoose.Types.ObjectId();
const orphanProduct = new mongoose.Types.ObjectId();

const category = await fixtures.createCategory({ name: `Probe Shop ${stamp}` });
const goodProduct = await fixtures.createProduct({
  name: "Probe Good Toy",
  category: category._id,
  stock: 5,
});
const goodProduct2 = await fixtures.createProduct({
  name: "Probe Second Toy",
  category: category._id,
  stock: 3,
});

// The broken ones. Written as rows that still carry an id pointing at nothing,
// because that is exactly what a deletion leaves behind and exactly what a
// populate turns into null.
await Product.create({
  name: "Probe Toy With No Category",
  type: "toy",
  description1: "Its category was deleted.",
  price: 100,
  stock: 2,
  sold: 0,
  category: orphanCategory,
  images: [],
});
await Product.create({
  name: "Probe Blocked Toy",
  type: "toy",
  description1: "Not shown to shoppers.",
  price: 100,
  stock: 2,
  sold: 0,
  isBlocked: true,
  category: category._id,
  images: [],
});

const shopper = await fixtures.createUser({ email: shopperEmail });
await User.updateOne(
  { _id: shopper._id },
  {
    $set: {
      password: await hashPassword(shopperPassword),
      isVerified: true,
      // A wishlist pointing at a product that is not there, and at one that is.
      wishlist: [orphanProduct, goodProduct._id],
    },
  },
);
await Wishlist.updateOne(
  { userId: shopper._id },
  { $set: { wishlist: [orphanProduct, goodProduct._id] } },
  { upsert: true },
);

// A product with offers that have since been deleted. The landing page asks for
// products holding three or more offers, so this is a row it will pick up, and it
// holds three ids with nothing behind them.
await Product.create({
  name: "Probe Toy With Dead Offers",
  type: "toy",
  description1: "Its offers were deleted.",
  price: 100,
  stock: 4,
  sold: 0,
  category: category._id,
  images: [],
  availableOffers: [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ],
});

// A product with no picture at all, which is what a record written before images
// were required looks like.
await Product.create({
  name: "Probe Toy With No Picture",
  type: "toy",
  description1: "No picture was ever set.",
  price: 100,
  stock: 4,
  sold: 0,
  category: category._id,
  images: [],
});

const order = await fixtures.createOrder({ user: shopper._id });
await fixtures.createAddress({ user: shopper._id, isDefault: true });
// An order whose customer is gone, as an administrator deleting an account or a
// database restore out of step would leave it.
await fixtures.createOrder({ user: new mongoose.Types.ObjectId() });
const deadProductLine = await fixtures.createOrder({ user: shopper._id });
await Order.updateOne(
  { _id: deadProductLine._id },
  { $set: { "items.0.product": new mongoose.Types.ObjectId() } },
);
const noAddressOrder = await fixtures.createOrder({ user: shopper._id });
await Order.updateOne({ _id: noAddressOrder._id }, { $unset: { address: "" } });

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

const csrfToken = (html) => html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? "";

// Signs in as the shopper. Everything past this point is asked as a person, so a
// page that needs a session is reached the way it is actually reached, rather than
// having its controller called directly and its session quietly skipped.
const loginPage = await request("/user/login");
const login = await request("/user/login", {
  form: {
    email: shopperEmail,
    password: shopperPassword,
    _csrf: csrfToken(loginPage.text),
  },
});
console.log(`shopper login: ${login.status} -> ${login.location}\n`);
if (login.status !== 302) {
  console.error("could not sign in, so the pages that need a session cannot be checked");
  process.exit(1);
}

// Pages are asked for as they are, and each is asked for twice where the shop has
// two ways to reach it, because a page reached by two routes is two chances to
// have been given different data.
const pages = [
  ["home", "/"],
  ["home", "/?sort=latest"],
  ["all categories", "/categories/all"],
  ["search", "/search"],
  ["search results", "/search/results?q=Probe"],
  ["category list", "/product/categories"],
  ["product details", `/product/${goodProduct._id}`],
  ["category page", `/user/category/${category._id}`],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
  ["account", "/account"],
  ["addresses", "/account/address"],
  ["edit address", `/account/edit-address/${(await fixtures.createAddress({ user: shopper._id }))._id}`],
  ["change password", "/account/change-password"],
  ["order history", "/account/orders"],
  ["order details", `/account/orders/${order._id}`],
  ["order with a withdrawn line", `/account/orders/${deadProductLine._id}`],
  ["order with no address", `/account/orders/${noAddressOrder._id}`],
  ["cancel reason", `/account/orders/${order._id}/cancel-reason`],
  ["wishlist", "/account/wishlist"],
  ["wallet", "/account/wallet"],
  ["reviews", "/account/reviews"],
  ["login page", "/user/login"],
  ["signup page", "/user/signup"],
  ["forgot password", "/user/forgot-password"],
  ["reset password", "/user/reset-password"],
];

const failures = [];

// The shapes a failure takes when it is rendered into a page instead of logged.
// A shopper should not be shown any of them, and most of them are recognisable
// even when the page is otherwise perfectly good.
const crashMarks = [
  "is not defined",
  "Cannot read propert",
  "Cannot read properties of",
  "TypeError:",
  "ReferenceError:",
  "at eval (",
  "at Object.",
  "at Module.",
  "at async",
  "Internal Server Error",
];

for (const [name, path] of pages) {
  const response = await request(path);
  const problems = [];

  // A redirect is a page saying "not here, try there", which is an answer. But a
  // redirect that goes nowhere, or a 404 for a page that exists, is not.
  const redirected = response.status >= 300 && response.status < 400;
  if (!redirected && response.status !== 200) {
    problems.push(`answered ${response.status}`);
  }
  if (response.status >= 500) {
    problems.push("the server fell over");
  }

  if (!redirected && /text\/html/.test(response.contentType ?? "")) {
    for (const mark of crashMarks) {
      const at = response.text.indexOf(mark);
      if (at === -1) continue;
      problems.push(
        `the page shows the inside of a failure: ...${response.text.slice(Math.max(0, at - 90), at + 90).replace(/\s+/g, " ")}...`,
      );
      break;
    }
  }

  if (problems.length === 0) {
    console.log(`  pass  ${name.padEnd(18)} ${path} ${redirected ? `-> ${response.location}` : response.status}`);
  } else {
    console.log(`  FAIL  ${name.padEnd(18)} ${path} ${response.status}`);
    for (const problem of problems) {
      console.log(`          ${problem}`);
    }
    failures.push({ name, path, problems });
  }
}

console.log(
  failures.length === 0
    ? `\nall ${pages.length} shopper pages answered`
    : `\n${pages.length - failures.length} of ${pages.length} shopper pages answered; ${failures.length} failed`,
);
process.exit(failures.length === 0 ? 0 : 1);
