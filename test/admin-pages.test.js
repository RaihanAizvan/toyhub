import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import mongoose from "mongoose";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Category from "../models/categories.model.js";
import Order from "../models/orders.models.js";
import Product from "../models/product.models.js";
import adminOrder from "../controllers/adminModules/order.js";
import addCategory from "../controllers/adminModules/addCategory.js";
import productList from "../controllers/adminModules/productList.js";
import { injectCsrfFields } from "../utils/csrf.js";
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
  objectId,
} from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// These pages are the ones an administrator reaches *because* something is already
// wrong: a product whose category is gone, an order whose customer is gone, a form
// that refused to save. Each of those is a missing reference in the database, which
// is the easiest thing in the world to produce by deleting one row, and none of
// them should answer with a crash.
//
// The reason they could is that a page and the rows it was given can disagree: the
// reference was cleared, the row it pointed at was not. So each test writes exactly
// that state and asks for the page.

// What a page says when it has nothing to show is a question of taste, but what it
// must not do is show the reader the innards. These are the shapes of failure worth
// refusing to accept in a response.
const crashMarks = [
  "is not defined",
  "Cannot read propert",
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
      `the page showed ${mark}, which is the inside of a failure rather than an answer:\n${html.slice(0, 400)}`,
    );
  }
};

const postForm = async (baseUrl, requestPath, body) => {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  return {
    status: response.status,
    html: await response.text(),
  };
};

describe("admin pages that answer about things which have gone wrong", () => {
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
    app.set("layout", "./layouts/layout");
    app.use(expressLayouts);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(
      session({
        name: "toyhub.sid",
        secret: "t".repeat(32),
        resave: false,
        saveUninitialized: true,
      }),
    );
    app.use((req, _res, next) => {
      req.session.sAdminEmail = "admin@example.invalid";
      next();
    });
    app.locals.injectCsrfFields = injectCsrfFields;
    app.locals.toast = null;
    app.locals.flashMessage = null;

    // The category routes go through the image uploader in the application. Here
    // the request simply arrives without a file, which is the same thing as asking
    // to change a category's words and leave its picture alone.
    const withUploadedFiles = (req, _res, next) => {
      const { files, ...body } = req.body ?? {};
      req.body = body;
      req.files = files ?? {};
      next();
    };

    app.get("/admin/products", productList.getProductList);
    app.get("/admin/orders", adminOrder.getAdminOrders);
    app.post(
      "/admin/category/edit/:id",
      withUploadedFiles,
      addCategory.postEditCategory,
    );

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (reachable) {
      await clearTestDatabase();
      await disconnectTestDatabase();
    }
  });

  it("lists products even when one of them points at a category that is gone", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const category = await createCategory();
    const kept = await createProduct({ category: category._id });

    // The broken reference is written the way a deletion leaves it: the id is
    // still on the product, and there is nothing behind it.
    const orphan = await createProduct();
    await Product.updateOne(
      { _id: orphan._id },
      { category: objectId() },
    );

    // A generous page size, because the whole test suite shares one database and
    // another file's products can be on page one too. What is being asked about
    // here is this page rendering, not which page it lands on.
    const response = await fetch(`${baseUrl}/admin/products?limit=100`);
    const html = await response.text();

    assert.equal(response.status, 200);
    expectNoCrash(html);
    assert.ok(
      html.includes(kept.name),
      "the products that are fine should still be on the list",
    );
  });

  it("lists orders even when one of them points at a customer that is gone", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const kept = await createOrder();
    const orphan = await createOrder();
    await Order.updateOne(
      { _id: orphan._id },
      { user: objectId() },
    );

    const response = await fetch(`${baseUrl}/admin/orders?limit=100`);
    const html = await response.text();

    assert.equal(response.status, 200);
    expectNoCrash(html);
    assert.ok(
      html.includes(String(kept._id)),
      "the orders that are fine should still be on the list",
    );
  });

  it("says what was wrong with the name, on the form the administrator came from", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const category = await createCategory({ name: "Building Blocks" });

    const { status, html } = await postForm(
      baseUrl,
      `/admin/category/edit/${category._id}`,
      { name: "" },
    );

    assert.equal(status, 400);
    expectNoCrash(html);
    assert.match(html, /Category name is required/);
    // The form asks for the category it is editing in its very first field, so a
    // refusal that does not hand it back cannot render at all.
    assert.match(html, /Building Blocks/);

    // The refusal must also leave the category as it was, rather than half-saved.
    const unchanged = await Category.findById(category._id).lean();
    assert.equal(unchanged.name, "Building Blocks");
  });

  it("says the name is taken, on the same form", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const category = await createCategory({ name: "Building Blocks" });
    await createCategory({ name: "Puzzles" });

    const { status, html } = await postForm(
      baseUrl,
      `/admin/category/edit/${category._id}`,
      { name: "puzzles" },
    );

    assert.equal(status, 400);
    expectNoCrash(html);
    assert.match(html, /already exists/i);
  });

  it("keeps what was typed, so a refusal can be corrected rather than retyped", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    await createCategory({ name: "Puzzles" });
    const category = await createCategory({ name: "Building Blocks" });

    const { status, html } = await postForm(
      baseUrl,
      `/admin/category/edit/${category._id}`,
      { name: "puzzles" },
    );

    assert.equal(status, 400);
    assert.match(html, /value="puzzles"/);
  });

  it("answers an id that is not an id as a missing category, not a server fault", async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }

    const { status, html } = await postForm(
      baseUrl,
      `/admin/category/edit/not-an-id`,
      { name: "Anything" },
    );

    assert.equal(status, 404);
    expectNoCrash(html);
  });
});

// The object id a missing row keeps is still shaped like an object id, so these
// references are indistinguishable from good ones without looking them up. That is
// the whole difficulty of these bugs, and the reason they have to be written down
// as tests rather than left to be noticed.
it("is why the tests above exist", () => {
  assert.ok(mongoose.Types.ObjectId.isValid(objectId()));
  assert.notEqual(String(objectId()), String(objectId()));
});
