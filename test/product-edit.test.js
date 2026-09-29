import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Product from "../models/product.models.js";
import productList from "../controllers/adminModules/productList.js";
import {
  IMAGES_PER_PRODUCT,
  imagesForEdit,
  readProductEditForm,
} from "../utils/product-form.js";
import { publicIdFor } from "../utils/uploads.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { resetUploader, setUploader } from "../utils/uploads.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import { createCategory, createProduct } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// A picture already on the image host, in the shape the delivery addresses are
// stored in: the address is what a page shows, and the name after `/upload/` is
// what the host can remove.
const storedImage = (name) => `https://res.cloudinary.com/shop/image/upload/v1700000000/uploads/${name}.jpg`;

// The edit form's fields, all valid, so a test only has to say what it is
// breaking. It is the same form the add form posts, which is the point: the two
// used to read the same words and store them under different ones.
const validForm = (overrides = {}) => ({
  title: "Wooden Pulling Robot",
  description1: "A wooden robot that walks when you pull it along.",
  description2: "Made from beech wood with a cotton string.",
  category: "",
  warning: "Not recommended for children below 3",
  type: "Toy",
  color: "Red",
  weight: "250",
  discount: "20",
  sku: "ROB-1",
  stock_quantity: "12",
  regular_price: "500",
  ...overrides,
});

// New pictures, in the shape the upload middleware leaves them in.
const uploaded = (names, { cropped = null, mimetype = "image/png" } = {}) => {
  const files = { files: [] };

  names.forEach((name, index) => {
    files.files.push({
      fieldname: "files",
      originalname: name,
      mimetype,
      path: storedImage(`new-${name.replace(/\.\w+$/, "")}`),
      public_id: `uploads/new-${name.replace(/\.\w+$/, "")}`,
    });

    if (cropped === null || cropped.includes(index)) {
      files[`croppedImage_${index}`] = [
        {
          fieldname: `croppedImage_${index}`,
          originalname: name,
          mimetype,
          path: storedImage(`cropped-${name.replace(/\.\w+$/, "")}`),
          public_id: `uploads/cropped-${name.replace(/\.\w+$/, "")}`,
        },
      ];
    }
  });

  return files;
};

describe("which pictures an edit keeps", () => {
  const current = [storedImage("one"), storedImage("two"), storedImage("three")];

  it("a request that says nothing about the pictures keeps all of them", () => {
    const result = imagesForEdit({}, {}, current);

    assert.deepEqual(result.images, current, "an edit about something else is not an edit about the pictures");
    assert.deepEqual(result.removed, []);
  });

  it("a picture that is not ticked is the one that is removed", () => {
    const result = imagesForEdit(
      { knownImages: current, keepImages: [current[0], current[2]] },
      {},
      current,
    );

    assert.deepEqual(result.images, [current[0], current[2]]);
    assert.deepEqual(result.removed, [current[1]], "and it is the removed one that is reported");
  });

  it("a picture the product does not have cannot be kept, and is not lost either", () => {
    const someoneElses = storedImage("not-ours");
    const result = imagesForEdit(
      { knownImages: current, keepImages: [current[0], someoneElses] },
      {},
      current,
    );

    assert.deepEqual(result.images, [current[0]], "only this product's own pictures are used");
    assert.deepEqual(result.unknown, [someoneElses], "and the request is told which one was ignored");
    assert.deepEqual(result.removed, [current[1], current[2]]);
  });

  it("a new picture joins the ones being kept, and the five-picture limit holds", () => {
    const result = imagesForEdit(
      { knownImages: current, keepImages: current },
      uploaded(["four.png"]),
      current,
    );

    assert.deepEqual(result.images, [...current, storedImage("cropped-four")], "kept first, then added");
    assert.deepEqual(result.added, [storedImage("cropped-four")]);

    const overflowing = imagesForEdit(
      { knownImages: current, keepImages: current },
      uploaded(["four.png", "five.png"]),
      current,
    );
    assert.equal(overflowing.images.length, IMAGES_PER_PRODUCT, "a sixth is not silently kept");
  });

  it("an edit that keeps nothing and adds nothing leaves no product with no picture", () => {
    const category = "65b0f1c2a3d4e5f60718293a";

    // Not saying anything about the pictures keeps them, so this is a whole
    // product and passes.
    const { ok, errors } = readProductEditForm(validForm({ category }), {}, current);
    assert.equal(ok, true, JSON.stringify(errors));

    // Unchecking every one of them is a decision, and a product with no picture
    // is one this shop cannot sell, so it is refused with something to say. The
    // form has to say which pictures it was showing to say that, because an
    // unticked checkbox is sent as nothing at all.
    const { ok: refused, errors: refusedErrors } = readProductEditForm(
      { ...validForm({ category }), knownImages: current },
      {},
      current,
    );
    assert.equal(refused, false);
    assert.match(refusedErrors.imageError, /at least 1 image/);
  });
});

describe("a picture's name on the image host", () => {
  it("is read back out of the address a product stores", () => {
    assert.equal(publicIdFor(storedImage("one")), "uploads/one");
    assert.equal(publicIdFor("https://res.cloudinary.com/shop/image/upload/uploads/deep/name.png"), "uploads/deep/name");
    assert.equal(publicIdFor("https://res.cloudinary.com/shop/image/upload/v12/uploads/one"), "uploads/one");
  });

  it("is not guessed for an address this shop did not put there", () => {
    // Nothing is asked of the image host on the word of a path in a request.
    assert.equal(publicIdFor("/uploads/products/local.webp"), null);
    assert.equal(publicIdFor(""), null);
    assert.equal(publicIdFor(null), null);
  });
});

const reachable = await canReachTestDatabase();
const describeWhenReachable = reachable ? describe : describe.skip;

describeWhenReachable("editing a product", () => {
  let server;
  let destroyed;

  before(async () => {
    if (!(await connectTestDatabase())) {
      return;
    }

    setUploader({
      destroy: async (publicId) => {
        destroyed.push(publicId);
        return { result: "ok" };
      },
    });

    const app = express();
    app.set("views", viewsDirectory);
    app.set("view engine", "ejs");
    app.set("layout", "./layouts/layout");
    app.use(expressLayouts);
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({ name: "toyhub.sid", secret: "t".repeat(32), resave: false, saveUninitialized: true }));
    app.use((req, _res, next) => {
      req.session.sAdminEmail = "admin@example.invalid";
      next();
    });
    app.locals.injectCsrfFields = injectCsrfFields;
    app.locals.toast = null;
    app.locals.flashMessage = null;

    // The upload middleware, without the upload: the request arrives already
    // carrying files in the shape the real middleware produces.
    const withUploadedFiles = (req, _res, next) => {
      const { files, ...body } = req.body ?? {};
      req.body = body;
      req.files = files ?? {};
      next();
    };

    app.get("/admin/products", productList.getProductList);
    app.get("/admin/editProduct/:id", productList.getEditProduct);
    app.post("/admin/editProduct/:id", withUploadedFiles, productList.postEditProduct);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    resetUploader();
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    if (!server) {
      return;
    }
    destroyed = [];
    await clearTestDatabase();
  });

  const base = () => `http://127.0.0.1:${server.address().port}`;

  const post = (id, body, files = {}) =>
    fetch(`${base()}/admin/editProduct/${id}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({ ...body, files }),
    });

  const send = async (id, body, files) => {
    const response = await post(id, body, files);
    return { response, data: await response.json().catch(() => ({})) };
  };

  // A product with a real category and the pictures a new product would have.
  // The category is made here rather than left to the fixture, because an edit
  // that names a category is refused when the shop does not have it.
  const shopProduct = async (overrides = {}) => {
    const { category, ...rest } = overrides;
    return createProduct({
      category: (await createCategory())._id,
      name: "Wooden Pulling Robot",
      description2: "Made from beech wood with a cotton string.",
      warnings: "Not recommended for children below 3",
      type: "Toy",
      color: "Red",
      weight: 250,
      discount: 20,
      price: 500,
      priceAfterDiscount: 400,
      SKU: "ROB-1",
      stock: 12,
      images: [storedImage("one"), storedImage("two")],
      ...rest,
      ...(category ? { category } : {}),
    });
  };

  it("a text-only edit saves every field under the name the schema uses", async () => {
    const product = await shopProduct();
    const body = validForm({ category: String(product.category) });

    const { response, data } = await send(product._id, body);

    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.success, true);

    const saved = await Product.findById(product._id);
    assert.equal(saved.name, "Wooden Pulling Robot", "the form's title is the product's name");
    assert.equal(saved.warnings, "Not recommended for children below 3", "and the warning is warnings");
    assert.equal(saved.SKU, "ROB-1");
    assert.equal(saved.stock, 12, "a number, not \"12\"");
    assert.equal(saved.price, 500);
    assert.equal(saved.weight, 250);
    assert.equal(saved.discount, 20);
    assert.equal(saved.priceAfterDiscount, 400, "the price a shopper pays is worked out again");
  });

  it("an edit that changes nothing but a price still keeps the pictures", async () => {
    const product = await shopProduct();
    const body = validForm({ category: String(product.category), regular_price: "900" });

    await send(product._id, body);

    const saved = await Product.findById(product._id);
    assert.equal(saved.price, 900);
    assert.deepEqual(saved.images, product.images, "the pictures are not touched by a text edit");
    assert.deepEqual(destroyed, [], "and nothing was removed from the image host");
  });

  it("a product keeps what the shop knows about it that the form does not", async () => {
    // What a shopper has seen about the product is not the edit form's to set,
    // and writing the whole document from the form is how it was lost.
    const product = await shopProduct({ sold: 17, averageRating: 4.5, ratingCount: 12 });

    await send(product._id, validForm({ category: String(product.category) }));

    const saved = await Product.findById(product._id);
    assert.equal(saved.sold, 17, "how much has sold is not the edit form's to decide");
    assert.equal(saved.averageRating, 4.5);
    assert.equal(saved.ratingCount, 12);
    assert.equal(saved.isBlocked, false);
  });

  it("a new picture joins the ones being kept, and the originals are given back", async () => {
    const product = await shopProduct();
    const body = {
      ...validForm({ category: String(product.category) }),
      knownImages: product.images,
      keepImages: [product.images[0]],
    };

    const { response, data } = await send(product._id, body, uploaded(["three.png"]));

    assert.equal(response.status, 200, JSON.stringify(data));
    const saved = await Product.findById(product._id);
    assert.deepEqual(saved.images, [product.images[0], storedImage("cropped-three")]);

    assert.deepEqual(
      destroyed.sort(),
      ["uploads/new-three", "uploads/two"],
      "the crop the product shows is kept, the original behind it is given back, and the picture that was unticked is removed",
    );
  });

  it("a picture that is unticked is taken off the product and off the image host", async () => {
    const product = await shopProduct();
    const body = {
      ...validForm({ category: String(product.category) }),
      knownImages: product.images,
      keepImages: [product.images[0]],
    };

    await send(product._id, body);

    const saved = await Product.findById(product._id);
    assert.deepEqual(saved.images, [product.images[0]]);
    assert.deepEqual(destroyed, ["uploads/two"], "and the image host is told, by its own name for it");
  });

  it("a removal is not carried out until the product has been saved", async () => {
    // The image host cannot un-delete a picture, so removing one before the write
    // would leave a product pointing at a picture that is gone if the write then
    // failed.
    const product = await shopProduct();
    const body = {
      ...validForm({ category: String(product.category), title: "no" }),
      knownImages: product.images,
      keepImages: [product.images[0]],
    };

    const { response, data } = await send(product._id, body);

    assert.equal(response.status, 400);
    assert.match(data.errors.titleError, /at least 5/);

    const saved = await Product.findById(product._id);
    assert.deepEqual(saved.images, product.images, "the refused edit left the product as it was");
    assert.deepEqual(destroyed, [], "and left the image host alone");
  });

  it("a refused edit leaves the product exactly as it was", async () => {
    const product = await shopProduct();

    const { response, data } = await send(product._id, validForm({
      category: String(product.category),
      regular_price: "not a price",
    }));

    assert.equal(response.status, 400);
    assert.match(data.errors.regular_priceError, /must be a number/);
    assert.equal(data.values.regular_price, "not a price", "and hands back what was typed");

    const saved = await Product.findById(product._id);
    assert.equal(saved.price, 500);
    assert.equal(saved.name, "Wooden Pulling Robot");
  });

  it("a product that does not exist is refused, not created", async () => {
    const missing = "65b0f1c2a3d4e5f60718293a";
    const { response, data } = await send(missing, validForm({ category: missing }));

    assert.equal(response.status, 404);
    assert.match(data.errors.formError, /not in the shop/);
    assert.equal(await Product.countDocuments(), 0, "and nothing was written");
  });

  it("an id that is not an id is refused, not looked up", async () => {
    for (const id of ["not-an-id", "..", "%20"]) {
      const { response } = await send(encodeURIComponent(id), validForm({ category: "x" }));
      assert.equal(response.status, 404, `"${id}" is a request for nothing`);
    }
  });

  it("a name another product already has is refused, and a product keeping its own name is not", async () => {
    const product = await shopProduct();
    const other = await shopProduct({ name: "Painted Wooden Train" });

    const refused = await send(product._id, validForm({
      category: String(product.category),
      title: "Painted Wooden Train",
    }));
    assert.equal(refused.response.status, 400);
    assert.match(refused.data.errors.titleError, /already exists/);
    assert.equal((await Product.findById(product._id)).name, "Wooden Pulling Robot", "and it kept its own name");

    const renamed = await send(product._id, validForm({
      category: String(product.category),
      title: "Wooden Pulling Robot Deluxe",
    }));
    assert.equal(renamed.response.status, 200, JSON.stringify(renamed.data));
    assert.equal((await Product.findById(other._id)).name, "Painted Wooden Train", "and the other product is untouched");
  });

  it("a category that is not the shop's own is a mistake, not a server error", async () => {
    const product = await shopProduct();

    const { response, data } = await send(product._id, validForm({
      category: "65b0f1c2a3d4e5f60718293a",
    }));

    assert.equal(response.status, 400);
    assert.match(data.errors.categoryError, /category/i);
    assert.equal((await Product.findById(product._id)).name, "Wooden Pulling Robot");
  });

  it("a field that is emptied is emptied, rather than left as it was", async () => {
    const product = await shopProduct();

    await send(product._id, validForm({
      category: String(product.category),
      description2: "",
      color: "",
    }));

    const saved = await Product.findById(product._id);
    assert.equal(saved.description2, "", "clearing the box is a decision, not an omission");
    assert.equal(saved.color, "");
    assert.equal(saved.description1, "A wooden robot that walks when you pull it along.", "and the rest is still there");
  });

  it("the edited product renders for an administrator and for a shopper", async () => {
    const product = await shopProduct();

    const edit = await fetch(`${base()}/admin/editProduct/${product._id}`).then((r) => r.text());
    assert.match(edit, /Wooden Pulling Robot/);
    assert.match(edit, new RegExp(`value="${product.images[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), "the pictures it holds are offered as ones to keep");
    assert.match(edit, new RegExp(`action="/admin/editProduct/${product._id}"`), "and the form posts back to this product");

    await send(product._id, validForm({
      category: String(product.category),
      title: "Wooden Pulling Robot Deluxe",
    }));

    const list = await fetch(`${base()}/admin/products`).then((r) => r.text());
    assert.match(list, /Wooden Pulling Robot Deluxe/, "and the list shows the name it was given");
    assert.doesNotMatch(list, /Wooden Pulling Robot</, "rather than the one it was given before");
  });

  it("a product whose category is not in the offered list is still in the list offered", async () => {
    // A product is not moved out of its category by that category being hidden,
    // and a form that does not offer the answer it is showing saves whichever
    // category happens to be first.
    const hidden = await createCategory({ name: "Hidden", isActive: false });
    const product = await shopProduct({ category: hidden._id });

    const page = await fetch(`${base()}/admin/editProduct/${product._id}`).then((r) => r.text());
    assert.match(page, /Hidden/, "the category it is in is offered");
    assert.match(page, new RegExp(`<option value="${hidden._id}" selected`), "and is the one selected");
  });

  it("a request that is not the form gets the page back, not a page of json", async () => {
    const product = await shopProduct();

    const response = await fetch(`${base()}/admin/editProduct/${product._id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validForm({ category: String(product.category), title: "no" }) }),
    });

    const page = await response.text();
    assert.equal(response.status, 400);
    assert.match(page, /at least 5 characters/, "and it says what was wrong, in the page's own words");
    assert.doesNotMatch(page, /"errors"/, "rather than as a json body the browser cannot read");
  });
});
