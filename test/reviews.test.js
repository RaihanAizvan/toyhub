import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";

import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import Rating from "../models/ratings.models.js";
import User from "../models/users.models.js";
import productRoutes from "../routes/productRoute.js";
import reviewRoutes from "../routes/profileRoutes.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  createCategory,
  createOrder,
  createProduct,
  createRating,
  createUser,
} from "./helpers/fixtures.js";
import { injectCsrfFields } from "../utils/csrf.js";
import {
  parseRating,
  summariseRatings,
  isEligibleOrderStatus,
} from "../utils/reviews.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

let category;
let product;
let buyer;
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
  // The real server names its layout; without this every page render is a 500
  // that says nothing about the page.
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

  // The review route reads `req.session.user`, so a test has to be able to
  // arrange one. This is the shape the login code writes.
  app.use((req, _res, next) => {
    const as = req.query.as;
    if (as) {
      req.session.user = { id: as };
    }
    next();
  });

  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    // The layout asks for this by name, the same way the real server registers it.
    res.locals.injectCsrfFields = injectCsrfFields;
    res.locals.user = req.session.user ?? null;
    res.locals.path = req.path;
    next();
  });

  app.use("/product", productRoutes);
  app.use("/account", reviewRoutes);
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
    sku: "REVIEW-1",
    category: category._id,
  });
  buyer = await createUser({ name: "Buyer Person" });
  await createOrder({
    user: buyer._id,
    items: [{ product: product._id, quantity: 1, price: 500 }],
    status: "delivered",
    paid: true,
  });
});

// `?as=<id>` is how a test says who is signed in. The answer is read as text and
// then parsed, so a test can say what came back even when it is not JSON.
const postReviewAs = async (userId, productId, body) => {
  const response = await fetch(`${baseUrl}/product/${productId}/review?as=${userId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, text };
};

const review = (body, id = product._id) => postReviewAs(buyer._id, id, body);

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

describe("ratings and reviews", () => {
  describe("the rules on their own", () => {
    it("a rating is a whole number from 1 to 5 and nothing else", () => {
      for (const good of [1, 2, 3, 4, 5, "1", "4", " 5 "]) {
        assert.notEqual(parseRating(good), null, `${JSON.stringify(good)} should be allowed`);
      }
      for (const bad of [0, 6, -1, 2.5, "2.5", "", "  ", "four", "5abc", null, undefined, {}, [], NaN, 1e9]) {
        assert.equal(parseRating(bad), null, `${JSON.stringify(bad)} should be refused`);
      }
    });

    it("only a sent or delivered order makes someone an eligible reviewer", () => {
      assert.equal(isEligibleOrderStatus("delivered"), true);
      assert.equal(isEligibleOrderStatus("shipped"), true);
      assert.equal(isEligibleOrderStatus("Delivered"), true, "old rows were capitalised");
      assert.equal(isEligibleOrderStatus("pending"), false, "a pending order can still be cancelled");
      assert.equal(isEligibleOrderStatus("cancelled"), false);
      assert.equal(isEligibleOrderStatus(undefined), false);
    });

    it("the summary leaves out rejected reviews and rounds the average", () => {
      const summary = summariseRatings([
        { rating: 5, status: "approved" },
        { rating: 4, status: "pending" },
        { rating: 1, status: "rejected" },
        { rating: 3, status: "approved" },
      ]);

      assert.equal(summary.ratingCount, 3, "the rejected one is not counted");
      assert.equal(summary.averageRating, 4);
      assert.deepEqual(summary.ratingStats, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });

      const empty = summariseRatings([]);
      assert.equal(empty.ratingCount, 0);
      assert.equal(empty.averageRating, 0, "no reviews is zero, not a division by zero");
    });

    it("a summary ignores a rating that is out of range", () => {
      const summary = summariseRatings([
        { rating: 4, status: "approved" },
        { rating: 99, status: "approved" },
      ]);
      assert.equal(summary.ratingCount, 1, "a row the schema would not hold is not counted");
      assert.equal(summary.averageRating, 4);
    });
  });

  whenReachable("a buyer can review a product they received", async () => {
    const response = await review({ rating: 5, title: "Wonderful", comment: "It walks." });

    assert.equal(response.status, 201);
    assert.equal(response.body.message, "Review submitted successfully");

    const stored = await Rating.findOne({ productId: product._id, userId: buyer._id }).lean();
    assert.equal(stored.rating, 5);
    assert.equal(stored.title, "Wonderful");
    assert.equal(stored.isVerifiedPurchase, true, "the order was checked, not assumed");

    const summary = await Product.findById(product._id).lean();
    assert.equal(summary.ratingCount, 1);
    assert.equal(summary.averageRating, 5);
    assert.equal(summary.ratingStats[5], 1);
    assert.deepEqual(
      summary.ratings.map(String),
      [String(stored._id)],
      "the product's own list of reviews is in step with the totals",
    );
  });

  whenReachable("someone who has not received the product is refused", async () => {
    const stranger = await createUser({ name: "Stranger" });

    const nothing = await postReviewAs(stranger._id, product._id, { rating: 5 });
    assert.equal(nothing.status, 403, "no order at all");
    assert.match(nothing.text, /only review a product you have received/);

    // An order for a different product says nothing about this one.
    const somethingElse = await createProduct({
      name: "Other Robot",
      description1: "A robot for the shop.",
      sku: "OTHER-1",
      category: category._id,
    });
    await createOrder({
      user: stranger._id,
      items: [{ product: somethingElse._id, quantity: 1, price: 500 }],
      status: "delivered",
      paid: true,
    });

    const elsewhere = await postReviewAs(stranger._id, product._id, { rating: 5 });
    assert.equal(elsewhere.status, 403, "an order for another product");
    assert.match(
      elsewhere.text,
      /only review a product you have received/,
      `expected the reason, got ${elsewhere.text}`,
    );

    assert.equal(
      await Rating.countDocuments({ userId: stranger._id }),
      0,
      "nothing was written for the stranger",
    );
  });

  whenReachable("an order that was never sent does not qualify", async () => {
    const waiting = await createUser({ name: "Waiting" });
    await createOrder({
      user: waiting._id,
      items: [{ product: product._id, quantity: 1, price: 500 }],
      status: "pending",
      paid: true,
    });

    const response = await postReviewAs(waiting._id, product._id, { rating: 5 });

    assert.equal(response.status, 403, "a pending order says nothing about receiving it");
  });

  whenReachable("a signed out visitor is refused", async () => {
    const response = await fetch(`${baseUrl}/product/${product._id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rating: 5 }),
    });

    assert.equal(response.status, 401);
  });

  whenReachable("a rating outside the range is refused with a reason", async () => {
    for (const bad of [0, 6, -3, 2.5, "five", ""]) {
      const response = await review({ rating: bad });
      assert.equal(response.status, 400, `rating ${JSON.stringify(bad)} was not refused`);
      assert.match(response.body.message, /1 to 5/);
    }
    assert.equal(await Rating.countDocuments({}), 0);
  });

  whenReachable("long text is cut to the limit rather than lost", async () => {
    const response = await review({
      rating: 4,
      title: "T".repeat(500),
      comment: "C".repeat(5000),
    });

    assert.equal(response.status, 201);
    const stored = await Rating.findOne({ productId: product._id, userId: buyer._id }).lean();
    assert.equal(stored.title.length, 120);
    assert.equal(stored.comment.length, 2000);
  });

  whenReachable("a second review of the same product edits the first", async () => {
    await review({ rating: 1, title: "First", comment: "It broke." });
    const response = await review({ rating: 5, title: "Second", comment: "It works now." });

    assert.equal(response.status, 200);
    assert.equal(response.body.message, "Review updated successfully");
    assert.equal(await Rating.countDocuments({}), 1, "not a second row");

    const summary = await Product.findById(product._id).lean();
    assert.equal(summary.ratingCount, 1);
    assert.equal(summary.averageRating, 5, "the count is of reviews, and it is one");
    assert.deepEqual(summary.ratingStats, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 });
    assert.equal(summary.ratings.length, 1, "the product's list has one id, not two");
  });

  whenReachable("the database refuses two reviews even if two arrive together", async () => {
    // Nothing written yet, so exactly one of two simultaneous writes can win.
    const [first, second] = await Promise.all([
      Rating.create({
        productId: product._id,
        userId: buyer._id,
        rating: 4,
        status: "pending",
      }).catch((error) => error),
      Rating.create({
        productId: product._id,
        userId: buyer._id,
        rating: 2,
        status: "pending",
      }).catch((error) => error),
    ]);

    const failures = [first, second].filter((outcome) => outcome instanceof Error);
    assert.equal(
      failures.length,
      1,
      `two simultaneous writes for one person, ${failures.length} were turned away`,
    );
    assert.equal(failures[0].code, 11000);
    assert.equal(
      await Rating.countDocuments({ productId: product._id, userId: buyer._id }),
      1,
      "one review, whichever write won",
    );
  });

  whenReachable("reviewing a product that is not there is a 404, not a 500", async () => {
    const doomed = await createProduct({
      name: "Temporary Robot",
      description1: "A robot for the shop.",
      sku: "GONE-1",
      category: category._id,
    });
    const missingId = doomed._id.toString();
    await Product.deleteOne({ _id: doomed._id });

    const gone = await review({ rating: 5 }, missingId);
    assert.equal(gone.status, 404, "a deleted product is not a server error");
    assert.match(gone.body.message, /does not exist/);

    const nonsense = await review({ rating: 5 }, "not-an-id");
    assert.equal(nonsense.status, 404, "an id no database would recognise");
  });

  whenReachable("the aggregates are right after many different reviews", async () => {
    const people = [buyer];
    for (let index = 0; index < 4; index += 1) {
      const person = await createUser({ name: `Reviewer ${index}` });
      await createOrder({
        user: person._id,
        items: [{ product: product._id, quantity: 1, price: 500 }],
        status: "delivered",
        paid: true,
      });
      people.push(person);
    }

    const stars = [5, 4, 4, 3, 2];
    for (const [index, person] of people.entries()) {
      const response = await fetch(
        `${baseUrl}/product/${product._id}/review?as=${person._id}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating: stars[index] }),
        },
      );
      assert.equal(response.status, 201);
    }

    const summary = await Product.findById(product._id).lean();
    assert.equal(summary.ratingCount, 5);
    assert.equal(summary.averageRating, 3.6);
    assert.deepEqual(summary.ratingStats, { 1: 0, 2: 1, 3: 1, 4: 2, 5: 1 });
    assert.equal(summary.ratings.length, 5, "the list and the count agree");

    const counted = Object.values(summary.ratingStats).reduce((sum, value) => sum + value, 0);
    assert.equal(counted, summary.ratingCount, "the five bars add up to the total");
  });

  whenReachable("a rejected review stops counting", async () => {
    await review({ rating: 5 });
    assert.equal((await Product.findById(product._id).lean()).ratingCount, 1);

    await Rating.updateOne(
      { productId: product._id },
      { $set: { status: "rejected" } },
    );

    // A second review by another buyer recomputes the summary from scratch.
    const other = await createUser({ name: "Second Buyer" });
    await createOrder({
      user: other._id,
      items: [{ product: product._id, quantity: 1, price: 500 }],
      status: "shipped",
      paid: true,
    });
    await postReviewAs(other._id, product._id, { rating: 2 });

    const summary = await Product.findById(product._id).lean();
    assert.equal(summary.averageRating, 2, "the rejected one is gone from the average");
    assert.equal(summary.ratingStats[5], 0);
  });

  whenReachable("the product page answers for a product with no reviews", async () => {
    const response = await fetch(`${baseUrl}/product/${product._id}`);

    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /Based on 0 reviews/);
    assert.doesNotMatch(page, /Cannot read/);
  });

  whenReachable("the product page answers after its reviewers delete their accounts", async () => {
    await review({ rating: 4, title: "Solid", comment: "Held together well." });

    await User.deleteOne({ _id: buyer._id });

    const response = await fetch(`${baseUrl}/product/${product._id}`);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /Deleted account/, "the review says who it was, without inventing a name");
    assert.match(page, /Based on 1 reviews/);
  });

  whenReachable("the reviews page answers after the product is deleted", async () => {
    await review({ rating: 4, title: "Solid", comment: "Held together well." });

    const gone = await createProduct({
      name: "Doomed Robot",
      description1: "A robot for the shop.",
      sku: "DOOMED-1",
      category: category._id,
    });
    await createRating({
      productId: gone._id,
      userId: buyer._id,
      rating: 5,
      status: "approved",
    });
    await Product.deleteOne({ _id: gone._id });

    const response = await fetch(`${baseUrl}/account/reviews?as=${buyer._id}`);
    assert.equal(response.status, 200, "a review outliving its product is still a review");
    const page = await response.text();
    assert.match(page, /no longer available/);
  });

  whenReachable("a review survives the product's id being nonsense", async () => {
    await review({ rating: 4 });

    // A row whose productId is not even a valid id must not take the page down.
    await Rating.collection.updateOne(
      { productId: product._id },
      { $set: { productId: "not-an-object-id" } },
    );

    const response = await fetch(`${baseUrl}/account/reviews?as=${buyer._id}`);
    assert.equal(response.status, 200);
  });
});

describe("reviews are one per person", () => {
  whenReachable("the index refuses a second row for the same product and user", async () => {
    await Rating.create({
      productId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      rating: 4,
      status: "approved",
    });
    const { productId, userId } = await Rating.findOne().lean();
    await Rating.create({ productId, userId, rating: 5, status: "approved" }).then(
      () => {
        throw new Error("the database allowed two reviews from one person");
      },
      (error) => assert.equal(error.code, 11000),
    );
  });
});