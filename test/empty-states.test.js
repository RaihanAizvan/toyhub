import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Order from "../models/orders.models.js";
import Cart from "../models/cart.models.js";
import User from "../models/users.models.js";
import cartRouter from "../routes/cartRoute.js";
import checkoutRouter from "../routes/checkoutRoute.js";
import profileRouter from "../routes/profileRoutes.js";
import landing from "../controllers/userModules/landing.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { passwordPolicyScript } from "../utils/password-policy.js";
import { phonePolicyScript } from "../utils/phone-number.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createCart,
  createCategory,
  createOrder,
  createProduct,
  createUser,
  objectId,
} from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// A page is asked for in the state a shopper can really arrive with it: a cart
// that was never filled, an account with no addresses, an order whose product
// was withdrawn. None of those are errors, so none of them may answer with the
// inside of one. The test reads the same pages the shop does, through the real
// routers, and refuses the crash marks a template shows when it reads through a
// missing piece.
const crashMarks = [
  "is not defined",
  "Cannot read propert",
  "Cannot read properties of",
  "TypeError",
  "ReferenceError",
  "at eval (",
  "at Object.",
  "at Module.",
  "at async",
];

const expectNoCrash = (html, where) => {
  for (const mark of crashMarks) {
    assert.ok(
      !html.includes(mark),
      `${where} showed ${mark}, which is the inside of a failure:\n${html.slice(0, 400)}`,
    );
  }
};

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.set("layout", "./layouts/layout");
  app.use(expressLayouts);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "e".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );

  app.locals.injectCsrfFields = injectCsrfFields;
  app.locals.passwordPolicyScript = passwordPolicyScript;
  app.locals.phonePolicyScript = phonePolicyScript;

  app.use((req, res, next) => {
    res.locals.toast = null;
    res.locals.flashMessage = null;
    res.locals.name = req.session.user?.name ?? null;
    res.locals.csrfToken = "test-csrf-token";
    if (req.headers["x-test-user"]) {
      req.session.user = { id: req.headers["x-test-user"], name: "Probe Shopper" };
    }
    next();
  });

  app.get("/", landing.getLandingPage);
  app.use("/cart", cartRouter);
  app.use("/checkout", checkoutRouter);
  app.use("/account", profileRouter);

  app.use((req, res) => res.status(404).send("not found"));
  app.use((error, _req, res, _next) => {
    console.error("EMPTY-STATE PAGE ERROR:", error?.message);
    res.status(500).send("not found");
  });

  return app;
};

let server;
let baseUrl;
let reachable = false;
let userId;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  await connectTestDatabase();

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
  await disconnectTestDatabase();
});

beforeEach(async () => {
  if (!reachable) {
    return;
  }
  await clearTestDatabase();
  const user = await createUser({ name: "Probe Shopper" });
  userId = user._id;
});

const ask = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    headers: { "x-test-user": String(userId) },
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    html: await response.text(),
  };
};

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

describe("a signed-in shopper's pages read as themselves when there is nothing to show", () => {
  whenReachable("the landing page renders with no products or categories", async () => {
    const { status, html } = await ask("/");
    assert.equal(status, 200);
    expectNoCrash(html, "the landing page");
  });

  whenReachable("the landing page renders for a visitor who is not signed in", async () => {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });
    assert.equal(response.status, 200);
    expectNoCrash(await response.text(), "the signed-out landing page");
  });

  whenReachable("the cart renders empty", async () => {
    const { status, html } = await ask("/cart");
    assert.equal(status, 200);
    expectNoCrash(html, "the cart");
  });

  whenReachable("checkout renders with no address on file", async () => {
    const category = await createCategory({ name: "Robots" });
    const product = await createProduct({ category: category._id, price: 500 });
    await createCart({
      user: userId,
      items: [{ product: product._id, quantity: 1, price: 500, discountPrice: 500 }],
    });

    const { status, html } = await ask("/checkout");
    assert.equal(status, 200);
    expectNoCrash(html, "checkout");
  });

  whenReachable("the order history renders with no orders", async () => {
    const { status, html } = await ask("/account/orders");
    assert.equal(status, 200);
    expectNoCrash(html, "the order history");
  });

  whenReachable("the wishlist renders with nothing saved", async () => {
    const { status, html } = await ask("/account/wishlist");
    assert.equal(status, 200);
    expectNoCrash(html, "the wishlist");
  });

  whenReachable("the wallet page renders before any money is added", async () => {
    const { status, html } = await ask("/account/wallet");
    assert.equal(status, 200);
    expectNoCrash(html, "the wallet page");
  });
});

describe("pages whose records are only partly filled in", () => {
  whenReachable("the order history shows an order that has no address recorded", async () => {
    const order = await createOrder({ user: userId });
    await Order.updateOne({ _id: order._id }, { $unset: { address: "" } });

    const { status, html } = await ask("/account/orders");
    assert.equal(status, 200);
    expectNoCrash(html, "the order history with a missing address");
  });

  whenReachable("the cart shows a line whose product was withdrawn", async () => {
    const category = await createCategory({ name: "Robots" });
    const product = await createProduct({ category: category._id, price: 500 });
    const cart = await createCart({
      user: userId,
      items: [{ product: product._id, quantity: 1, price: 500, discountPrice: 500 }],
    });
    await Cart.updateOne(
      { _id: cart._id },
      { $set: { "items.0.product": objectId() } },
    );

    const { status, html } = await ask("/cart");
    assert.equal(status, 200);
    expectNoCrash(html, "the cart");
  });

  whenReachable("the wishlist shows a saved product that was later withdrawn", async () => {
    await User.updateOne({ _id: userId }, { $set: { wishlist: [objectId()] } });

    const { status, html } = await ask("/account/wishlist");
    assert.equal(status, 200);
    expectNoCrash(html, "the wishlist with a withdrawn product");
  });
});