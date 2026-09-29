import Product from "../../models/product.models.js";
import Category from '../../models/categories.model.js';
import { formValues, readProductForm } from "../../utils/product-form.js";
import { destroyUploadedImages } from "../../utils/uploads.js";

// The form's names, the schema's names and the arithmetic that connects a
// discount to a price are all in utils/product-form.js, so this file is the
// request: check it, write it once, and say what happened.

export async function getAddProduct(req, res) {
  if (!req.session.sAdminEmail) {
    return res.redirect("/admin")
  }
  try {
    const categories = await Category.find({});
    res.render("admin/addProduct", { categories });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching categories");
  }
}

// The form sends its pictures with fetch and reads the answer as JSON, because
// the cropped versions are built in the browser. A form that arrives any other
// way is answered with the page it would have shown.
const wantsJson = (req) =>
  req.xhr === true || String(req.get?.("accept") ?? "").includes("application/json");

// The one place a refused create request is answered, so every refusal looks the
// same: what was wrong, beside which field, and the values that were typed so
// they are not typed again. A product is only written once everything has
// passed, so there is nothing to clean up when this is called.
const refuse = async (req, res, errors, { status = 400, values = formValues(req.body), categories = null } = {}) => {
  if (wantsJson(req)) {
    return res.status(status).json({ success: false, errors, values });
  }

  const list = categories ?? (await Category.find({}).catch(() => []));
  return res.status(status).render("admin/addProduct", { categories: list, errors, values });
};

async function postAddProduct(req, res) {
  const categories = await Category.find({}).catch((error) => {
    console.error("Error fetching categories:", error);
    return [];
  });

  // With several fields and several files, reading them one at a time is how a
  // value gets read under a name it is not stored under. They are all read
  // together, and the answer says which ones are wrong.
  const { ok, values, errors, images } = readProductForm(req.body, req.files);

  if (!ok) {
    await destroyUploadedImages(req.files);
    return refuse(req, res, errors, { categories });
  }

  // The two questions the form cannot answer for itself: does the category
  // exist, and has this name been used. Both are asked before anything is
  // written, so a refusal leaves no product and no category changed.
  const [category, duplicate] = await Promise.all([
    Category.findById(values.category).catch(() => null),
    Product.findOne({ name: values.name }).catch(() => null),
  ]);

  if (!category) {
    await destroyUploadedImages(req.files);
    return refuse(req, res, {
      ...errors,
      categoryError: "Choose a category from the list",
    }, { categories });
  }

  if (duplicate) {
    await destroyUploadedImages(req.files);
    return refuse(req, res, {
      ...errors,
      titleError: "A product with this title already exists",
    }, { categories });
  }

  // Everything the shopper's pages read is written here, so a new product is
  // complete on the day it is created rather than filled in by whatever page
  // happens to open it next: no offers yet, nothing sold, and the price after
  // the discount worked out from the price and the discount together.
  const product = new Product({
    name: values.name,
    description1: values.description1,
    ...(values.description2 ? { description2: values.description2 } : {}),
    warnings: values.warnings,
    type: values.type,
    ...(values.color ? { color: values.color } : {}),
    weight: values.weight,
    discount: values.discount,
    price: values.price,
    priceAfterDiscount: values.priceAfterDiscount,
    SKU: values.SKU,
    category: values.category,
    images,
    stock: values.stock,
    sold: 0,
    offerDiscount: 0,
    availableOffers: [],
    isBlocked: false,
  });

  try {
    // The product is written first, because the category needs its id to point
    // at. If the category cannot be updated the product is taken back out, so
    // the shop is never left with a product nothing lists and a category that
    // lists a product that is not there.
    await product.save();
  } catch (error) {
    console.error("Error adding product:", error);
    await destroyUploadedImages(req.files);
    return refuse(req, res, {
      ...errors,
      formError: "The product could not be saved. Nothing has been changed.",
    }, { status: 500, categories });
  }

  try {
    await Category.findByIdAndUpdate(values.category, { $push: { products: product._id } });
  } catch (error) {
    console.error("Error adding product to its category:", error);
    await Product.deleteOne({ _id: product._id }).catch(() => null);
    await destroyUploadedImages(req.files);
    return refuse(req, res, {
      ...errors,
      formError: "The product could not be added to its category, so nothing was created.",
    }, { status: 500, categories });
  }

  // The product is created and holds its pictures. The originals the
  // administrator picked are not stored anywhere, so they are given back rather
  // than left on the image host for a product that does not show them.
  await destroyUploadedImages(req.files, { keep: images });

  req.session.toast = { message: 'Product added successfully!', type: 'success' };
  delete req.session.flashMessage;

  // Straight to the product, not back to the form: the administrator's next
  // question is "did it save what I typed?", and the answer is on the page
  // that shows it.
  const target = `/admin/products?added=${product._id}`;

  if (wantsJson(req)) {
    return res.json({ success: true, product: { _id: product._id, name: product.name }, redirect: target });
  }

  return res.redirect(target);
}

export default {
  getAddProduct,
  postAddProduct,
}
