import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Category from "../models/categories.model.js";
import adminCategory from "../controllers/adminModules/addCategory.js";
import userCategory from "../controllers/userModules/category.js";
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
} from "./helpers/fixtures.js";
import { injectCsrfFields } from "../utils/csrf.js";
import {
  CATEGORY_NAME_MAX,
  CATEGORY_NAME_MIN,
  escapedCategoryName,
  isCategoryName,
} from "../utils/categories.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

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

  // The admin controllers check for a signed-in admin, the user pages for the
  // layout locals. The session declares the first, the locals the second.
  app.use((req, _res, next) => {
    req.session.sAdminEmail = "admin@example.invalid";
    next();
  });
  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.injectCsrfFields = injectCsrfFields;
    res.locals.user = null;
    res.locals.path = req.path;
    next();
  });

  // The real routes run multer's cloudinary upload first. Testing that would be
  // testing cloudinary; the request arrives with no file, which is a valid state
  // the controller already handles.
  const withoutUpload = (req, _res, next) => {
    req.file = undefined;
    next();
  };

  app.get("/admin/category", adminCategory.getAddCategory);
  app.post("/admin/category", withoutUpload, adminCategory.postAddCategory);
  app.get("/admin/category/edit/:id", adminCategory.getEditCategory);
  app.post("/admin/category/edit/:id", withoutUpload, adminCategory.postEditCategory);
  app.post("/admin/category/delete/:id", adminCategory.postDeleteCategory);

  app.get("/categories", userCategory.getCategoryList);
  app.get("/categories/all", userCategory.viewAllCategories);
  app.get("/category/:id", userCategory.getProductsByCategory);

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
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

const post = (pathname, body, { follow } = {}) =>
  fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    redirect: follow ? "follow" : "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

const get = (pathname) => fetch(`${baseUrl}${pathname}`);

describe("categories", () => {
  describe("the name rules", () => {
    it("a category name is trimmed, and three to thirty characters", () => {
      assert.equal(isCategoryName("Toys"), true);
      assert.equal(isCategoryName("  Robots  "), true, "surrounding space is not part of the name");
      assert.equal(isCategoryName("ab"), false, "too short");
      assert.equal(isCategoryName("a".repeat(CATEGORY_NAME_MAX + 1)), false, "too long");
      assert.equal(isCategoryName(""), false);
      assert.equal(isCategoryName("   "), false);
      assert.equal(isCategoryName(undefined), false);
    });

    it("a name that means something in a regex is kept literal", () => {
      const tricky = "A+B*(C)[D]{E}$^.?|";
      assert.equal(
        escapedCategoryName(tricky),
        String(tricky).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      assert.equal(isCategoryName(tricky), true, "such a name is still a category name");
    });
  });

  describe("admin create, edit, and hide", () => {
    whenReachable("create stores the name, a live flag, and an image", async () => {
      const response = await post("/admin/category", { name: " Building Blocks " });

      assert.equal(response.status, 302);
      const saved = await Category.findOne({ name: "Building Blocks" }).lean();
      assert.ok(saved, "the trimmed name is stored");
      assert.equal(saved.isActive, true, "a new category is visible immediately");
      assert.equal(saved.image, "");
    });

    whenReachable("a duplicate name is refused, whatever its case", async () => {
      await createCategory({ name: "Puzzles" });
      const response = await post("/admin/category", { name: "puzzles" });
      const text = await response.text();

      assert.equal(response.status, 400);
      assert.match(text, /already exists/);
    });

    whenReachable("a name full of regex characters is not a duplicate of nothing", async () => {
      const tricky = "X+(Y)*(Z)";
      await createCategory({ name: tricky });
      const response = await post("/admin/category", { name: tricky });
      const text = await response.text();

      assert.equal(response.status, 400, "the very same name is caught the second time");
      assert.match(text, /already exists/);
    });

    whenReachable("a too-short name is refused, not saved", async () => {
      const response = await post("/admin/category", { name: "ab" });
      assert.equal(response.status, 400);
      assert.equal(await Category.countDocuments(), 0);
    });

    whenReachable("edit renames, and still refuses a name another has", async () => {
      const category = await createCategory({ name: "First" });
      await createCategory({ name: "Taken" });

      const edit = await post(`/admin/category/edit/${category._id}`, { name: "Second" });
      assert.equal(edit.status, 302);
      assert.equal((await Category.findById(category._id).lean())?.name, "Second");

      const clash = await post(`/admin/category/edit/${category._id}`, { name: "TAKEN" });
      assert.equal(clash.status, 400, "case-insensitive, even when editing a different one");
    });

    whenReachable("the delete button hides and shows, it does not erase", async () => {
      const category = await createCategory({ name: "Toggle Me" });
      assert.equal(category.isActive, true);

      const hide = await post(`/admin/category/delete/${category._id}`);
      assert.equal(hide.status, 302);
      assert.equal((await Category.findById(category._id).lean())?.isActive, false);

      const show = await post(`/admin/category/delete/${category._id}`);
      assert.equal(show.status, 302);
      assert.equal((await Category.findById(category._id).lean())?.isActive, true);
    });
  });

  describe("what the storefront shows", () => {
    whenReachable("the list shows only live categories", async () => {
      await createCategory({ name: "Visible One" });
      await createCategory({ name: "Hidden One", isActive: false });

      const page = await (await get("/categories")).text();
      assert.match(page, /Visible One/);
      assert.doesNotMatch(page, /Hidden One/);
    });

    whenReachable("a category's count is what the shop is selling", async () => {
      const category = await createCategory({ name: "Counted" });
      await Promise.all([
        createProduct({ category: category._id }),
        createProduct({ category: category._id }),
        createProduct({ category: category._id, isBlocked: true }),
      ]);

      const page = await (await get("/categories")).text();
      assert.match(page, /Explore 2 products/);
    });

    whenReachable("a category page lists what the shop is selling", async () => {
      const category = await createCategory({ name: "Robots" });
      await Promise.all([
        createProduct({ category: category._id, name: "Robot A" }),
        createProduct({ category: category._id, name: "Robot B", isBlocked: true }),
      ]);

      const page = await (await get(`/category/${category._id}`)).text();
      assert.match(page, /Robot A/);
      assert.doesNotMatch(page, /Robot B/, "a blocked product is not for sale here");
      assert.match(page, /Robots/, "the page says which category it is");
    });

    whenReachable("a hidden category sells nothing, even by direct address", async () => {
      const category = await createCategory({ name: "Hidden", isActive: false });
      await createProduct({ category: category._id, name: "Secret Toy" });

      const response = await get(`/category/${category._id}`);
      const text = await response.text();
      assert.doesNotMatch(text, /Secret Toy/);
    });

    whenReachable("a malformed id is answered as not found", async () => {
      const response = await fetch(`${baseUrl}/category/not-an-id`, { redirect: "manual" });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/");
    });

    whenReachable("an empty category has a valid empty state", async () => {
      const category = await createCategory({ name: "Nothing Here" });
      const page = await (await get(`/category/${category._id}`)).text();
      assert.match(page, /No products found in this category/);
    });
  });
});