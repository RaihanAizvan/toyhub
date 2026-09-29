import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Category from "../models/categories.model.js";
import Product from "../models/product.models.js";
import addProducts from "../controllers/adminModules/addProducts.js";
import productList from "../controllers/adminModules/productList.js";
import {
  IMAGES_PER_PRODUCT,
  imagesFrom,
  priceAfterDiscount,
  readNumber,
  readProductForm,
} from "../utils/product-form.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { describeUploadError } from "../utils/multer.js";
import { resetUploader, setUploader } from "../utils/uploads.js";
import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import { createCategory } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// The form's own fields, with the values that are all valid, so a test only has
// to say which one it is breaking.
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

// What a request looks like once the upload middleware has done its work:
// `files` holds what was picked, and each `croppedImage_n` holds the crop of
// the file in that position.
const uploaded = (names, { cropped = null, mimetype = "image/png" } = {}) => {
  const files = { files: [] };

  names.forEach((name, index) => {
    const file = {
      fieldname: "files",
      originalname: name,
      mimetype,
      path: `https://images.example.invalid/uploads/${name}`,
      public_id: `uploads/${name.replace(/\.\w+$/, "")}`,
    };
    files.files.push(file);

    if (cropped === null || cropped.includes(index)) {
      files[`croppedImage_${index}`] = [
        {
          fieldname: `croppedImage_${index}`,
          originalname: name,
          mimetype,
          path: `https://images.example.invalid/uploads/cropped-${name}`,
          public_id: `uploads/cropped-${name.replace(/\.\w+$/, "")}`,
        },
      ];
    }
  });

  return files;
};

// The contract, asked directly. What the form says, and what the schema stores,
// are different words for the same thing, and a request that mixes them up
// should say so rather than save half a product.
describe("the add-product form", () => {
  it("a number is a number and nothing else", () => {
    assert.equal(readNumber("250"), 250);
    assert.equal(readNumber(" 12.5 "), 12.5);
    assert.equal(readNumber("0"), 0);
    assert.equal(readNumber(""), null);
    assert.equal(readNumber("   "), null);

    // "10kg" is a weight with a unit typed into it, not a weight. It used to be
    // read as 10 and then stored as text the database could not hold.
    assert.equal(readNumber("10kg"), null);
    assert.equal(readNumber("1,000"), null);
    assert.equal(readNumber("abc"), null);
    assert.equal(readNumber("1e5"), null);
  });

  it("every field is stored under the name the schema uses", () => {
    const { values, errors, ok } = readProductForm(
      validForm({ category: "65b0f1c2a3d4e5f60718293a" }),
      uploaded(["robot.png"]),
    );

    assert.equal(ok, true, JSON.stringify(errors));
    assert.deepEqual(Object.keys(errors), []);

    assert.equal(values.name, "Wooden Pulling Robot", "the form's title is the product's name");
    assert.equal(values.warnings, "Not recommended for children below 3", "and the warning is warnings");
    assert.equal(values.SKU, "ROB-1");
    assert.equal(values.stock, 12, "a number, not \"12\"");
    assert.equal(values.price, 500);
    assert.equal(values.weight, 250);
    assert.equal(values.discount, 20);
    assert.equal(values.category, "65b0f1c2a3d4e5f60718293a");
    assert.deepEqual(values.images, ["https://images.example.invalid/uploads/cropped-robot.png"]);
  });

  it("the price a shopper pays is worked out from the price and the discount", () => {
    assert.equal(priceAfterDiscount(500, 20), 400);
    assert.equal(priceAfterDiscount(500, 0), 500);
    assert.equal(priceAfterDiscount(99, 99), 1, "99 off 99 leaves a rupee, not nothing");
    assert.equal(priceAfterDiscount(500, 150), 0, "and a discount over a hundred never goes below nothing");

    const { values } = readProductForm(
      validForm({ category: "65b0f1c2a3d4e5f60718293a", regular_price: "500", discount: "20" }),
      uploaded(["robot.png"]),
    );
    assert.equal(values.priceAfterDiscount, 400, "and stored, so the shopper's pages can read it");
  });

  it("a missing field is named, and the others are still read", () => {
    const { ok, errors } = readProductForm(
      validForm({ title: "", category: "65b0f1c2a3d4e5f60718293a" }),
      uploaded(["robot.png"]),
    );

    assert.equal(ok, false);
    assert.match(errors.titleError, /at least 5/);
    assert.equal(errors.regular_priceError, undefined, "the prices are fine");
  });

  it("a field that is not a number says so, in the field's own words", () => {
    const body = validForm({
      category: "65b0f1c2a3d4e5f60718293a",
      weight: "250g",
      discount: "twenty",
      stock_quantity: "1.5",
      regular_price: "-5",
    });
    const { ok, errors } = readProductForm(body, uploaded(["robot.png"]));

    assert.equal(ok, false);
    assert.match(errors.weightError, /number/);
    assert.match(errors.discountError, /number/);
    assert.match(errors.stock_quantityError, /whole number/);
    assert.match(errors.regular_priceError, /greater than 0/);
  });

  it("a discount is a percentage, not a number of any size", () => {
    const base = { category: "65b0f1c2a3d4e5f60718293a" };

    assert.equal(readProductForm(validForm({ ...base, discount: "100" }), uploaded(["a.png"])).ok, false);
    assert.equal(readProductForm(validForm({ ...base, discount: "-1" }), uploaded(["a.png"])).ok, false);
    assert.equal(readProductForm(validForm({ ...base, discount: "99" }), uploaded(["a.png"])).ok, true);
  });

  it("a category that is not a choice from the list is refused, not stored", () => {
    const { ok, errors } = readProductForm(
      validForm({ category: "not-an-id" }),
      uploaded(["robot.png"]),
    );

    assert.equal(ok, false);
    assert.match(errors.categoryError, /category/i);
  });

  it("a product needs a picture", () => {
    const body = validForm({ category: "65b0f1c2a3d4e5f60718293a" });

    const none = readProductForm(body, {});
    assert.equal(none.ok, false);
    assert.match(none.errors.imageError, /at least 1 image/);

    // The request that sends the field with nothing in it, which is what an
    // empty file input sends, is the same as sending no picture at all.
    const empty = readProductForm(body, { files: [], croppedImage_0: [] });
    assert.equal(empty.ok, false);
  });

  it("a file that is not an image is named in the answer", () => {
    const { ok, errors } = readProductForm(
      validForm({ category: "65b0f1c2a3d4e5f60718293a" }),
      uploaded(["robot.png"], { mimetype: "application/pdf" }),
    );

    assert.equal(ok, false);
    assert.match(errors.imageError, /robot\.png/);
    assert.match(errors.imageError, /jpg, png or webp/);
  });

  it("the cropped picture is the one that is stored, in the order they were arranged", () => {
    const files = uploaded(["a.png", "b.png", "c.png"]);

    assert.deepEqual(
      imagesFrom(files),
      [
        "https://images.example.invalid/uploads/cropped-a.png",
        "https://images.example.invalid/uploads/cropped-b.png",
        "https://images.example.invalid/uploads/cropped-c.png",
      ],
    );
  });

  it("a picture the administrator did not crop is still the product's picture", () => {
    // The second file was not cropped, so the original stands in for it. It
    // used to be dropped, and the product was saved with a hole where a picture
    // should have been.
    const files = uploaded(["a.png", "b.png", "c.png"], { cropped: [0, 2] });

    assert.deepEqual(
      imagesFrom(files),
      [
        "https://images.example.invalid/uploads/cropped-a.png",
        "https://images.example.invalid/uploads/b.png",
        "https://images.example.invalid/uploads/cropped-c.png",
      ],
    );
  });

  it("the number of pictures is the number the form takes", () => {
    assert.equal(IMAGES_PER_PRODUCT, 5);
    assert.equal(
      imagesFrom(uploaded(["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"])).length,
      5,
      "a sixth is not silently kept",
    );
  });
});

const reachable = await canReachTestDatabase();
const describeWhenReachable = reachable ? describe : describe.skip;

describeWhenReachable("adding a product", () => {
  let server;
  let destroyed;

  before(async () => {
    if (!(await connectTestDatabase())) {
      return;
    }

    // The image host is asked to give back what it was given, and this records
    // it instead of reaching the network.
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
    app.post("/admin/addProduct", (req, _res, next) => {
      const { files, ...body } = req.body ?? {};
      req.body = body;
      req.files = files ?? {};
      next();
    }, addProducts.postAddProduct);
    app.get("/admin/products", productList.getProductList);
    app.get("/admin/addProduct", addProducts.getAddProduct);

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

  const post = (body, files = {}, { as = "admin" } = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}/admin/addProduct`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-requested-with": as === "admin" ? "XMLHttpRequest" : "someone-else",
      },
      body: JSON.stringify({ ...body, files }),
    });

  // A form's fields, as the browser would send them: everything is a string, and
  // the pictures arrive separately from the upload middleware.
  const send = async (body, files) => {
    const response = await post(body, files);
    return { response, data: await response.json().catch(() => ({})) };
  };

  it("a complete product is saved whole, and the shop can list it", async () => {
    const category = await createCategory({ name: "Toys" });
    const body = validForm({ category: String(category._id) });

    const { response, data } = await send(body, uploaded(["front.png", "side.png"]));

    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.redirect, `/admin/products?added=${data.product._id}`);

    const saved = await Product.findById(data.product._id);
    assert.equal(saved.name, "Wooden Pulling Robot");
    assert.equal(saved.description1, body.description1);
    assert.equal(saved.description2, body.description2);
    assert.equal(saved.warnings, body.warning, "stored under the name the schema uses");
    assert.equal(saved.type, "Toy");
    assert.equal(saved.color, "Red");
    assert.equal(saved.weight, 250, "a number");
    assert.equal(saved.discount, 20);
    assert.equal(saved.price, 500);
    assert.equal(saved.priceAfterDiscount, 400, "what the shopper's pages read");
    assert.equal(saved.SKU, "ROB-1");
    assert.equal(saved.stock, 12, "a number, not the string the form sent");
    assert.equal(String(saved.category), String(category._id), "a reference to the category chosen");
    assert.equal(saved.sold, 0, "nothing sold yet");
    assert.equal(saved.offerDiscount, 0, "no offers yet");
    assert.equal(saved.isBlocked, false);
    assert.deepEqual(saved.ratingCount, 0);
    assert.deepEqual(saved.images, [
      "https://images.example.invalid/uploads/cropped-front.png",
      "https://images.example.invalid/uploads/cropped-side.png",
    ], "every uploaded picture, cropped, in order");

    const listed = await Category.findById(category._id);
    assert.equal(listed.products.length, 1, "and the category lists it");
    assert.equal(String(listed.products[0]), String(saved._id));

    assert.deepEqual(
      destroyed,
      ["uploads/front", "uploads/side"],
      "the product shows the crops, so the originals it does not show are given back",
    );
  });

  it("the product is where the shop is sent, and the page shows what was saved", async () => {
    const category = await createCategory({ name: "Toys" });
    const { data } = await send(validForm({ category: String(category._id) }), uploaded(["front.png"]));

    const listed = await fetch(`http://127.0.0.1:${server.address().port}/admin/products`);
    const page = await listed.text();

    assert.equal(listed.status, 200);
    assert.match(page, /Wooden Pulling Robot/, "the product that was just added is on the list");
    assert.match(page, /cropped-front\.png/, "with the picture that was uploaded");
  });

  it("a missing field is refused by name, and nothing is created", async () => {
    const category = await createCategory({ name: "Toys" });
    const body = validForm({ category: String(category._id) });
    delete body.stock_quantity;
    delete body.type;

    const { response, data } = await send(body, uploaded(["front.png"]));

    assert.equal(response.status, 400);
    assert.equal(data.success, false);
    assert.match(data.errors.stock_quantityError, /stock quantity/i);
    assert.match(data.errors.typeError, /type/i);

    assert.equal(await Product.countDocuments(), 0, "no product");
    assert.equal((await Category.findById(category._id)).products.length, 0, "and the category is unchanged");
  });

  it("what was typed is handed back, so it is not typed again", async () => {
    const { data } = await send(
      validForm({ title: "", weight: "250g", category: "" }),
      uploaded(["front.png"]),
    );

    assert.equal(data.values.title, undefined, "an empty box has nothing to keep");
    assert.equal(data.values.weight, "250g", "a wrong one is kept, so it can be corrected");
    assert.equal(data.values.sku, "ROB-1", "and so is every right one");
  });

  it("a number that is not a number is refused, and the product is not half-saved", async () => {
    const category = await createCategory({ name: "Toys" });

    const { response, data } = await send(
      validForm({ category: String(category._id), regular_price: "500 rupees" }),
      uploaded(["front.png"]),
    );

    assert.equal(response.status, 400);
    assert.match(data.errors.regular_priceError, /number/);
    assert.equal(await Product.countDocuments(), 0);
  });

  it("a discount over a hundred is refused", async () => {
    const category = await createCategory({ name: "Toys" });

    const { response, data } = await send(
      validForm({ category: String(category._id), discount: "150" }),
      uploaded(["front.png"]),
    );

    assert.equal(response.status, 400);
    assert.match(data.errors.discountError, /between 0 and 99/);
    assert.equal(await Product.countDocuments(), 0);
  });

  it("a product with no picture is refused, and the uploads it did send are given back", async () => {
    const category = await createCategory({ name: "Toys" });

    const { response, data } = await send(validForm({ category: String(category._id) }), {});

    assert.equal(response.status, 400);
    assert.match(data.errors.imageError, /at least 1 image/);
    assert.equal(await Product.countDocuments(), 0);
  });

  it("a file that is not an image is refused, and it is named", async () => {
    const category = await createCategory({ name: "Toys" });

    const { response, data } = await send(
      validForm({ category: String(category._id) }),
      uploaded(["brochure.pdf"], { mimetype: "application/pdf" }),
    );

    assert.equal(response.status, 400);
    assert.match(data.errors.imageError, /brochure\.pdf/);
    assert.equal(await Product.countDocuments(), 0);
    assert.deepEqual(destroyed, ["uploads/brochure", "uploads/cropped-brochure"], "and the file is not left on the image host");
  });

  it("a category that does not exist is refused, rather than becoming a server error", async () => {
    const { response, data } = await send(
      validForm({ category: "65b0f1c2a3d4e5f60718293a" }),
      uploaded(["front.png"]),
    );

    assert.equal(response.status, 400, "a reference that is not there is a mistake, not a crash");
    assert.match(data.errors.categoryError, /category/i);
    assert.equal(await Product.countDocuments(), 0);
    assert.deepEqual(destroyed, ["uploads/front", "uploads/cropped-front"], "and every file it sent is given back");
  });

  it("a category that is not even an id is refused, the same way", async () => {
    const { response, data } = await send(
      validForm({ category: "<script>alert(1)</script>" }),
      uploaded(["front.png"]),
    );

    assert.equal(response.status, 400);
    assert.match(data.errors.categoryError, /category/i);
    assert.equal(await Product.countDocuments(), 0);
  });

  it("a name already in use is refused, and said to be the name's problem", async () => {
    const category = await createCategory({ name: "Toys" });
    await send(validForm({ category: String(category._id) }), uploaded(["front.png"]));

    const { response, data } = await send(
      validForm({ category: String(category._id), title: "Wooden Pulling Robot" }),
      uploaded(["second.png"]),
    );

    assert.equal(response.status, 400);
    assert.match(data.errors.titleError, /already exists/);
    assert.equal(await Product.countDocuments(), 1, "the product that was there is still the only one");
  });

  it("a refused upload is named, wherever it happened", () => {
    // These are the answers a person sees instead of a server error, so each one
    // says what to do about it.
    const tooBig = describeUploadError({ code: "LIMIT_FILE_SIZE" });
    const wrongType = describeUploadError({ code: "LIMIT_UNEXPECTED_FILE" });
    const tooMany = describeUploadError({ code: "LIMIT_FILE_COUNT" });

    for (const message of [tooBig, wrongType, tooMany, describeUploadError({})]) {
      assert.match(message, /\S/, "a refusal is never blank");
    }
    assert.match(tooBig, /5 MB/);
    assert.match(wrongType, /jpg/);
    assert.match(tooMany, /Too many files/);

    // It says nothing about the server, which cannot do anything about it.
    for (const message of [tooBig, wrongType, tooMany]) {
      assert.doesNotMatch(message, /error|exception|undefined/i);
    }
  });

  it("a request that is not the form gets the page back, not a page of json", async () => {
    const category = await createCategory({ name: "Toys" });
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/addProduct`,
      {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ...validForm({ category: String(category._id) }) }).toString(),
      },
    );

    assert.equal(response.status, 400, "the form is missing its pictures, and is told so");
    const page = await response.text();
    assert.match(page, /at least 1 image/, "in the page, where the pictures are chosen");
    assert.match(page, /Wooden Pulling Robot/, "with what was typed still in the boxes");
  });
});
