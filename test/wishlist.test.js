import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Product from "../models/product.models.js";
import User from "../models/users.models.js";
import profileRoutes from "../routes/profileRoutes.js";
import productRoutes from "../routes/productRoute.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createCategory,
  createProduct,
  createUser,
  objectId,
} from "./helpers/fixtures.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { wishlistContains, wishlistIdStrings } from "../utils/wishlist.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

let category;
let product;
let owner;
let stranger;
let server;
let baseUrl;
let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  await connectTestDatabase();
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(expressLayouts);
  app.set("layout", "./layouts/layout");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "s".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );

  // The wishlist routes read `req.session.user`, so `?as=<id>` is how a test
  // says who is signed in. This is the shape the login code writes.
  app.use((req, _res, next) => {
    const as = req.query.as;
    if (as) {
      req.session.user = { id: as };
    }
    next();
  });

  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.injectCsrfFields = injectCsrfFields;
    res.locals.user = req.session.user ?? null;
    res.locals.path = req.path;
    next();
  });

  app.use("/account", profileRoutes);
  app.use("/product", productRoutes);
  app.use((req, res) => res.status(404).send("not found"));
  app.use((error, _req, res, _next) => {
    console.error("TEST PAGE ERROR:", error?.message);
    res.status(500).send("not found");
  });

  server = app.listen(0);
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
  category = await createCategory({ name: "Robots" });
  product = await createProduct({
    name: "Walking Robot",
    description1: "A robot for the shop.",
    category: category._id,
  });
  owner = await createUser({ name: "Owner Person" });
  stranger = await createUser({ name: "Stranger Person" });
});

const json = (method, url, body) =>
  fetch(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const addAs = (userId, productId, body = { productId }) =>
  json("POST", `${baseUrl}/account/wishlist/${productId}?as=${userId}`, body);

const removeAs = (userId, productId) =>
  json("DELETE", `${baseUrl}/account/wishlist?as=${userId}`, { productId });

const storedWishlist = async (userId) => {
  const user = await User.findById(userId).lean();
  return (user?.wishlist || []).map(String);
};

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

describe("wishlist", () => {
  describe("comparing ids as text", () => {
    it("an ObjectId and the string that names it are the same entry", () => {
      const id = objectId();
      assert.equal(wishlistContains([id], String(id)), true);
      assert.equal(wishlistContains([String(id)], id), true);
      assert.equal(wishlistContains([id], String(objectId())), false);
    });

    it("a wishlist that is not a list is empty, not a crash", () => {
      assert.deepEqual(wishlistIdStrings(undefined), []);
      assert.deepEqual(wishlistIdStrings(null), []);
      assert.deepEqual(wishlistIdStrings("nope"), []);
    });
  });

  describe("reading and mutating it", () => {
    whenReachable("a request with no session is refused", async () => {
      const response = await json(
        "POST",
        `${baseUrl}/account/wishlist/${product._id}`,
        { productId: String(product._id) },
      );
      assert.equal(response.status, 403);
    });

    whenReachable("adding the same product twice leaves one entry", async () => {
      const first = await addAs(owner._id, product._id);
      const second = await addAs(owner._id, product._id);

      assert.equal(first.status, 200, "the first add succeeds");
      assert.equal(second.status, 200, "the second add is a success, not an error");
      assert.deepEqual(await storedWishlist(owner._id), [String(product._id)]);
    });

    whenReachable("the id in the path is enough on its own", async () => {
      const response = await addAs(owner._id, product._id, {});
      assert.equal(response.status, 200);
      assert.deepEqual(await storedWishlist(owner._id), [String(product._id)]);
    });

    whenReachable("removing something that is not there is a success", async () => {
      const response = await removeAs(owner._id, objectId());
      assert.equal(response.status, 200);
    });

    whenReachable("removing is idempotent and empties only that entry", async () => {
      await addAs(owner._id, product._id);
      const first = await removeAs(owner._id, product._id);
      const second = await removeAs(owner._id, product._id);

      assert.equal(first.status, 200);
      assert.equal(second.status, 200, "the second remove is still a success");
      assert.deepEqual(await storedWishlist(owner._id), []);
    });

    whenReachable("a product that does not exist is refused, not stored", async () => {
      const response = await addAs(owner._id, objectId());
      assert.equal(response.status, 404);
      assert.deepEqual(await storedWishlist(owner._id), []);
    });

    whenReachable("a malformed id is refused before it reaches the database", async () => {
      const response = await addAs(owner._id, "not-an-object-id");
      assert.equal(response.status, 400);
    });

    whenReachable("one person's request never touches another person's list", async () => {
      await addAs(owner._id, product._id);
      await removeAs(stranger._id, product._id);

      assert.deepEqual(
        await storedWishlist(owner._id),
        [String(product._id)],
        "the owner still has it",
      );
      assert.deepEqual(await storedWishlist(stranger._id), []);
    });

    whenReachable("a deleted product leaves the page and the account", async () => {
      await addAs(owner._id, product._id);
      await Product.deleteOne({ _id: product._id });

      const response = await fetch(
        `${baseUrl}/account/wishlist?as=${owner._id}`,
      );
      assert.equal(response.status, 200, "the page still renders");
      assert.deepEqual(
        await storedWishlist(owner._id),
        [],
        "the dead reference is pruned",
      );
    });

    // The button carries the product id as a literal, while the script that
    // handles it names a variable, so anchoring on the id picks the button and
    // not the definition below it.
    const heartClass = (productId) =>
      new RegExp(
        `toggleWishlistInSingleProduct\\(event, '${productId}'\\)[\\s\\S]{0,120}?text-(red|green)-500`,
      );

    whenReachable("the product page fills the heart for a wishlisted product", async () => {
      await addAs(owner._id, product._id);
      const response = await fetch(
        `${baseUrl}/product/${product._id}?as=${owner._id}`,
      );
      const html = await response.text();
      const match = html.match(heartClass(product._id));
      assert.equal(match?.[1], "red", "the heart is filled");
    });

    whenReachable("the product page leaves the heart unfilled otherwise", async () => {
      const response = await fetch(
        `${baseUrl}/product/${product._id}?as=${owner._id}`,
      );
      const html = await response.text();
      const match = html.match(heartClass(product._id));
      assert.equal(match?.[1], "green", "the heart is not filled");
    });
  });
});
