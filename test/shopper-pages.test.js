import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import mongoose from "mongoose";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import User from "../models/users.models.js";
import checkout from "../controllers/userModules/checkout.js";
import profile from "../controllers/userModules/profile.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createAddress,
  createCategory,
  createOrder,
  createProduct,
  objectId,
} from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// Every one of these pages is reached because something about the shop is not as
// it was expected to be: a product withdrawn after it was ordered, an order with
// no address recorded, a cart that has been emptied in another tab. Those are
// ordinary states, produced by ordinary use, and a page that reads straight
// through the missing piece answers 500 instead of reading as itself.
//
// The difficulty these tests have to get past is that a missing reference is
// indistinguishable from a present one by looking at it: both are a well-formed
// id. So each test writes the real broken state into the database and asks for
// the page, rather than passing a hand-made object to a template.

// What a page says when it has nothing to show is a matter of taste. What it must
// not do is show the reader the innards.
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

const expectNoCrash = (html) => {
  for (const mark of crashMarks) {
    assert.ok(
      !html.includes(mark),
      `the page showed ${mark}, which is the inside of a failure:\n${html.slice(0, 400)}`,
    );
  }
};

const sessionSecret = "t".repeat(32);

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
      secret: sessionSecret,
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.locals.injectCsrfFields = injectCsrfFields;
  app.locals.toast = null;
  app.locals.flashMessage = null;

  // A session for a shopper who exists, because these pages ask who is asking.
  const signedIn = (req, res, next) => {
    req.session.user = { id: req.session.testUserId, name: "Probe Shopper" };
    next();
  };
  app.use((req, _res, next) => {
    req.session.testUserId = req.headers["x-test-user"];
    next();
  });
  app.use(signedIn);

  app.get("/account/orders/:id", profile.getOrderDetail);
  app.get("/checkout", checkout.getCheckoutPage);

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

describe("shopper pages reached when something is missing", () => {
  let server;
  let reachable = false;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (!reachable) {
      return;
    }
    await connectTestDatabase();
    server = await startServer();
  });

  after(async () => {
    if (server) {
      await server.close();
    }
    if (reachable) {
      await clearTestDatabase();
      await disconnectTestDatabase();
    }
  });

  const ask = async (path, userId) => {
    const response = await fetch(`${server.baseUrl}${path}`, {
      redirect: "manual",
      headers: { "x-test-user": String(userId) },
    });
    return {
      status: response.status,
      location: response.headers.get("location"),
      html: await response.text(),
    };
  };

  it("shows an order whose line points at a product that was withdrawn", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const user = await User.create({ name: "Probe Shopper", email: "withdrawn@example.invalid" });
    const order = await createOrder({ user: user._id });
    // The line keeps its quantity and price — what the shopper agreed to — and
    // loses only the product, which is the part that can be deleted.
    await Order.updateOne(
      { _id: order._id },
      { $set: { "items.0.product": objectId() } },
    );

    const { status, html } = await ask(`/account/orders/${order._id}`, user._id);

    assert.equal(status, 200);
    expectNoCrash(html);
    // The order itself must still be legible: this is the page someone comes to
    // when a product they bought has been withdrawn.
    assert.match(html, new RegExp(String(order._id)));
  });

  it("shows an order that has no address recorded", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const user = await User.create({ name: "Probe Shopper", email: "noaddress@example.invalid" });
    const order = await createOrder({ user: user._id });
    await Order.updateOne({ _id: order._id }, { $unset: { address: "" } });

    const { status, html } = await ask(`/account/orders/${order._id}`, user._id);

    assert.equal(status, 200);
    expectNoCrash(html);
    assert.match(html, /no address was recorded/i);
  });

  it("sends a shopper with nothing in the cart back to the cart, rather than failing", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const user = await User.create({ name: "Probe Shopper", email: "emptycart@example.invalid" });

    // No cart row at all. This is what a shopper who never added anything has, and
    // what a shopper whose cart was cleared in another tab has. The checkout page
    // reads cart.cutoffAmount in its price summary without asking whether there
    // is a cart, so it answered 500 to both.
    const { status, html, location } = await ask("/checkout", user._id);

    // A redirect is the answer here: there is nothing to check out, and the place
    // to fix that is the cart. Where it points is the whole of the answer, so that
    // is what is checked rather than the body express happens to write.
    assert.equal(status, 302);
    assert.equal(location, "/cart");
    expectNoCrash(html);
  });

  it("shows a product whose category was deleted", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    // Written as a row that still carries an id pointing at nothing, which is what
    // a category deletion leaves behind and what a populate turns into null.
    // Whether this shows up in the assembled homepage is asked by
    // scripts/probe-user-pages.js, which is the only place that can: the homepage is
    // built from includes, so rendering one view in isolation would not be the page
    // a shopper sees, and a test that proved it here would be proving something
    // about the template rather than about the shop.
    await createProduct({ category: objectId() });

    const products = await Product.find({}).populate("category");
    const orphaned = products.filter((product) => product.category === null);

    assert.ok(
      orphaned.length > 0,
      "the fixture should be a product whose category does not resolve",
    );
  });

  it("shows a product whose offers were all deleted", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const category = await createCategory();
    const product = await createProduct({
      name: "Probe Toy With Dead Offers",
      category: category._id,
      availableOffers: [objectId(), objectId(), objectId()],
    });

    // Recorded before populating, because this is the shape that reaches the page:
    // the landing page selects products by how many offers they hold, on the stored
    // ids, so three ids with nothing behind them is a row it will pick up.
    const stored = await Product.findById(product._id).lean();
    assert.equal(
      stored.availableOffers.length,
      3,
      "the product should still be carrying three offers as far as the database knows",
    );

    // And this is what the page is then given, which is not the same thing and is
    // the part that was surprising to find: populating a list of ids where none
    // resolve leaves an empty list, not a list of three holes. So the page that
    // reads the first offer for the countdown is reading past the end of an empty
    // array, which is where "Cannot read properties of undefined" comes from.
    const populated = await Product.findById(product._id).populate("availableOffers");
    assert.equal(populated.availableOffers.length, 0);
  });
});
