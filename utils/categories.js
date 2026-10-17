// One definition of a category, used by the admin forms and the storefront
// alike. The two had drifted: the admin form read a `description` the schema
// has never had, the storefront asked about a `products` array nothing ever
// fills, and the name-uniqueness check built a regex out of the typed name, so
// a name containing `(` or `*` either matched nothing or threw.
import Category from "../models/categories.model.js";
import Product from "../models/product.models.js";

export const CATEGORY_NAME_MIN = 3;
export const CATEGORY_NAME_MAX = 30;

export const isCategoryName = (value) => {
  if (typeof value !== "string") {
    return false;
  }
  const name = value.trim();
  return (
    name.length >= CATEGORY_NAME_MIN && name.length <= CATEGORY_NAME_MAX
  );
};

// A duplicate check reads the name back out of a regex. The name is data, not
// a pattern, so every character that means something in a regex has to be made
// literal first.
export const escapedCategoryName = (name) =>
  String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const findCategoryNamed = (candidate, excludeId) => {
  const name = String(candidate ?? "").trim();
  const query = {
    name: { $regex: new RegExp(`^${escapedCategoryName(name)}$`, "i") },
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  return Category.findOne(query).lean();
};

export const categoryImage = (category) => category?.image || "/images/logo.png";

// Categories reach the storefront as documents whose product list nothing ever
// fills. The product count is real, not decorative: it asks the products where
// their category is set, counts what the shop is actually selling, and returns
// it as `productCount` rather than as an array the views were never going to
// render.
export const withProductCounts = async (categories) => {
  const docs = categories.map((category) => category.toObject?.() ?? category);
  const ids = docs.map((category) => category._id);
  const counts = await Product.aggregate([
    { $match: { category: { $in: ids }, isBlocked: false } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((row) => [String(row._id), row.count]));
  return docs.map((category) => ({
    ...category,
    productCount: byId.get(String(category._id)) || 0,
  }));
};