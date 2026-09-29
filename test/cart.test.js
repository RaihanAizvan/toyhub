import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Cart from "../models/cart.models.js";
import Product from "../models/product.models.js";
import { CSRF_HEADER_NAME, exposeCsrfToken, injectCsrfFields, verifyCsrfRequest } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import { createProduct, createUser } from "./helpers/fixtures.js";

applyTestEnv();

const cartRouter = (await import("../routes/cartRoute.js")).default;

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

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
      secret: "c".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );

  app.use((req, res, next) => {
    res.locals.name = req.session.user?.name;
    res.locals.toast = req.session.toast;
    delete req.session.toast;
    next();
  });

  app.locals.injectCsrfFields = injectCsrfFields;
  app.use(exposeCsrfToken);
  app.use(verifyCsrfRequest);

  // The suite plays the part of the login flow: the account a request acts as
  // is the one named by the x-test-user header.
  app.use((req, _res, next) => {
    const account = req.headers["x-test-user"];
    if (account) {
      req.session.user = { id: String(account), name: "Cart Tester" };
    }
    next();
  });

  app.get("/test/session", (req, res) => {
    res.json({ user: req.session.user ?? null, token: req.session.csrfToken ?? null });
  });

  app.use("/cart", cartRouter);

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

// One client is one browser: it keeps its session cookie and its CSRF token,
// exactly like a signed in shopper.
const createClient = (server, account) => {
  let cookie = null;
  let token = null;

  const prime = async () => {
    const primed = await fetch(`${server.baseUrl}/test/session`, {
      headers: account ? { "x-test-user": String(account) } : {},
    });
    cookie = primed.headers.getSetCookie?.()[0]?.split(";")[0] ?? null;
    token = (await primed.json()).token ?? null;
  };

  return async (requestPath, { method = "POST", body, json } = {}) => {
    if (token === null) {
      await prime();
    }

    const response = await fetch(`${server.baseUrl}${requestPath}`, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { [CSRF_HEADER_NAME]: token } : {}),
        ...(account ? { "x-test-user": String(account) } : {}),
        ...(json
          ? { "content-type": "application/json" }
          : body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
      },
      body: json ? JSON.stringify(json) : body ? new URLSearchParams(body).toString() : undefined,
    });

    return {
      status: response.status,
      location: response.headers.get("location"),
      text: await response.text(),
    };
  };
};

const send = (server, requestPath, { method = "POST", as: account, body, json } = {}) =>
  createClient(server, account)(requestPath, { method, body, json });

const ownCart = async (userId) => {
  const cart = await Cart.findOne({ user: userId }).populate("items.product");
  return cart;
};

describe("cart lines", () => {
  let server;
  let reachable = false;
  let connection = null;

  before(async () => {
    reachable = await canReachTestDatabase();
    if (!reachable) {
      return;
    }
    connection = await connectTestDatabase();
    await clearTestDatabase();
    server = await startServer();
  });

  after(async () => {
    await server?.close();
    if (connection) {
      await clearTestDatabase();
      await disconnectTestDatabase();
    }
  });

  beforeEach(async () => {
    if (reachable) {
      await clearTestDatabase();
    }
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("adding to a cart that does not exist yet creates it", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 400, stock: 10 });

    const response = await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });

    assert.equal(response.status, 200);

    const cart = await ownCart(user._id);
    assert.ok(cart, "a cart is created for the account");
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 2);
    assert.equal(cart.subtotal, 800, "the line is priced from the product");
    assert.equal(cart.total, 800);
  });

  itWhenReachable("adding the same product twice makes one line of the two quantities", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 250, stock: 20 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });
    const response = await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 3 }] },
    });

    assert.equal(response.status, 200);

    const cart = await ownCart(user._id);
    assert.equal(cart.items.length, 1, "the product is on one line");
    assert.equal(cart.items[0].quantity, 5);
    assert.equal(cart.subtotal, 1250);
  });

  itWhenReachable("a refused add leaves the cart exactly as it was", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 100, stock: 4 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 3 }] },
    });

    // The same request that would have taken the line past what is in stock.
    const refused = await send(server, "/cart/addProduct", {
      as: user._id,
      json: {
        products: [
          { productId: String(product._id), quantity: 2 },
          { productId: String((await createProduct({ stock: 5 }))._id), quantity: 99 },
        ],
      },
    });
    assert.ok(refused.status >= 400, "the request with the bad line is refused");

    const cart = await ownCart(user._id);
    assert.equal(cart.items.length, 1, "the good line is the only one there");
    assert.equal(cart.items[0].quantity, 3, "and it is unchanged");

    // The refused request must not have created a second line either.
    const stored = await Cart.findOne({ user: user._id });
    assert.equal(stored.items.length, 1);
  });

  itWhenReachable("more than the stock on hand is refused with a reason", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 100, stock: 2, name: "Nearly Gone" });

    const response = await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 5 }] },
    });

    assert.equal(response.status, 409);
    assert.match(response.text, /only 2 of nearly gone are left/i);
    assert.equal(await Cart.countDocuments({ user: user._id }), 0, "nothing is stored");
  });

  itWhenReachable("a quantity change is refused when the product cannot supply it", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 100, stock: 3 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 1 }] },
    });

    const response = await send(server, "/cart/update-quantity", {
      as: user._id,
      body: { productId: String(product._id), quantity: "9" },
    });

    assert.equal(response.status, 409);
    assert.match(response.text, /only 3 of/i);

    const cart = await ownCart(user._id);
    assert.equal(cart.items[0].quantity, 1, "the stored quantity is untouched");
  });

  itWhenReachable("a quantity change is answered with the totals the page draws", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 320, stock: 10 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 1 }] },
    });
    const response = await send(server, "/cart/update-quantity", {
      as: user._id,
      body: { productId: String(product._id), quantity: "4" },
    });

    assert.equal(response.status, 200);

    const payload = JSON.parse(response.text);
    assert.equal(payload.subtotal, 1280);
    assert.equal(payload.total, 1280);
    assert.equal(payload.cartItemCount, 1);
  });

  itWhenReachable("emptying the cart drops the lines and the coupon with them", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 300, stock: 10 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });
    await Cart.updateOne(
      { user: user._id },
      { $set: { appliedCoupon: "SAVED10", couponDiscount: 50 } },
    );

    const response = await send(server, "/cart/clear", { as: user._id });

    assert.equal(response.status, 200);
    assert.match(response.text, /cleared/i);

    const cart = await ownCart(user._id);
    assert.equal(cart.items.length, 0);
    assert.equal(cart.appliedCoupon, null, "a coupon has nothing left to be worth");
    assert.equal(cart.couponDiscount, 0);
    assert.equal(cart.subtotal, 0);
    assert.equal(cart.total, 0);
  });

  itWhenReachable("emptying a cart that was never there is not a failure", async () => {
    const user = await createUser();

    const response = await send(server, "/cart/clear", { as: user._id });

    assert.equal(response.status, 200);
    assert.match(response.text, /already empty/i);
  });

  itWhenReachable("removing the last line empties the cart and its coupon", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 300, stock: 10 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 1 }] },
    });
    await Cart.updateOne(
      { user: user._id },
      { $set: { appliedCoupon: "SAVED10", couponDiscount: 40 } },
    );

    const response = await send(server, "/cart/remove-item", {
      as: user._id,
      body: { productId: String(product._id) },
    });

    assert.equal(response.status, 200);

    const cart = await ownCart(user._id);
    assert.equal(cart.items.length, 0);
    assert.equal(cart.appliedCoupon, null);
    assert.equal(cart.couponDiscount, 0);
  });

  itWhenReachable("removing one of two lines leaves the other line priced", async () => {
    const user = await createUser();
    const kept = await createProduct({ price: 500, stock: 5 });
    const dropped = await createProduct({ price: 100, stock: 5 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: {
        products: [
          { productId: String(kept._id), quantity: 2 },
          { productId: String(dropped._id), quantity: 1 },
        ],
      },
    });
    await send(server, "/cart/remove-item", {
      as: user._id,
      body: { productId: String(dropped._id) },
    });

    const cart = await ownCart(user._id);
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 2);
    assert.equal(cart.subtotal, 1000);
  });

  itWhenReachable("a line whose product is gone still renders with a reason", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 450, stock: 4 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 1 }] },
    });
    await Product.deleteOne({ _id: product._id });

    const response = await send(server, "/cart", { method: "GET", as: user._id });

    assert.equal(response.status, 200);
    assert.match(response.text, /no longer available/i);
    // The page must not have blown up part way through drawing the summary.
    assert.match(response.text, /Cart Summary/i);

    const cart = await ownCart(user._id);
    assert.equal(cart.items[0].available, false, "the line is kept, marked as gone");
    assert.equal(cart.items[0].price, 0, "a product that no longer exists has no price");
    assert.equal(cart.excludedAmount, 0, "and is not an unknown amount either");
    assert.equal(cart.subtotal, 0);
  });

  itWhenReachable("a line whose product has run out says so instead of being buyable", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 450, stock: 4 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });
    await Product.updateOne({ _id: product._id }, { $set: { stock: 0 } });

    const response = await send(server, "/cart", { method: "GET", as: user._id });

    assert.equal(response.status, 200);
    assert.match(response.text, /out of stock/i);
    assert.match(response.text, /₹900\.00/, "the line still shows its price");

    const cart = await ownCart(user._id);
    assert.equal(cart.items[0].available, false, "the line is marked as not buyable");
    assert.match(cart.items[0].unavailableReason, /out of stock/i);
    assert.equal(cart.subtotal, 0, "a line that cannot be bought is not money");
    assert.equal(cart.total, 0);
    assert.equal(cart.excludedAmount, 900, "the summary reports what it is worth");
    assert.equal(cart.items[0].price, 450, "the line still shows what it would have cost");
  });

  itWhenReachable("an account with no cart at all is drawn as an empty cart", async () => {
    const user = await createUser();

    const response = await send(server, "/cart", { method: "GET", as: user._id });

    assert.equal(response.status, 200);
    assert.match(response.text, /Your cart is empty/i);
    assert.match(response.text, /Cart Summary/i);
    assert.match(response.text, /₹0\.00/, "the summary is all numbers, not blanks");
  });

  itWhenReachable("a cart saved before the offer field existed reads back its own money", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 300, stock: 10 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });

    // Write the raw document the way an older release would have, with the
    // line carrying only the fields it used to know.
    await Cart.updateOne(
      { user: user._id },
      {
        $set: {
          items: [
            {
              product: product._id,
              quantity: 2,
              price: 300,
              discountPrice: 300,
              image: product.images[0],
            },
          ],
          subtotal: 600,
          total: 600,
        },
      },
    );

    const response = await send(server, "/cart", { method: "GET", as: user._id });

    assert.equal(response.status, 200, "an old line is still drawn");
    assert.match(response.text, /₹600\.00/);
  });

  itWhenReachable("an offer on a line survives being stored and read back", async () => {
    const user = await createUser();
    const product = await createProduct({ price: 500, stock: 10 });

    await send(server, "/cart/addProduct", {
      as: user._id,
      json: { products: [{ productId: String(product._id), quantity: 2 }] },
    });

    // The offer discount is a number the controller works out and the view
    // draws, so it has to be a field the schema keeps rather than one that is
    // quietly dropped on the way to the database.
    await Cart.updateOne(
      { user: user._id },
      { $set: { "items.0.offerDiscount": 100 } },
    );

    const stored = await Cart.findOne({ user: user._id });
    assert.equal(stored.items[0].offerDiscount, 100, "the field is kept");
  });

  itWhenReachable("a request with no account is turned away before it reaches a cart", async () => {
    const product = await createProduct({ price: 100, stock: 5 });

    const response = await send(server, "/cart/addProduct", {
      json: { products: [{ productId: String(product._id), quantity: 1 }] },
    });

    assert.equal(response.status, 302, "the cart is behind the login");
    assert.match(response.location, /login/i);
    assert.equal(await Cart.countDocuments({}), 0, "nothing is stored for nobody");
  });

  itWhenReachable("a page view leaves no cart behind for an account that never had one", async () => {
    const user = await createUser();

    await send(server, "/cart", { method: "GET", as: user._id });

    assert.equal(
      await Cart.countDocuments({ user: user._id }),
      0,
      "looking at the cart does not create one",
    );
  });
});
