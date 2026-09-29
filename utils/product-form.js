// What the add-product form sends, and what the Product schema stores, are two
// different sets of names, and the mapping between them used to live in the
// middle of a request handler: a field was read under the name the form gave it
// and written under a name that did not exist on the schema, so it was dropped
// by the database rather than saved. It is written down here instead, with the
// checks that decide whether a request is allowed to become a product, so the
// form, the handler and the schema can be read against each other.
//
// Nothing here touches the database. Whether a category exists, or whether
// another product already carries this name, is asked of the shop itself by the
// handler, and its answer is merged in.

export const IMAGES_PER_PRODUCT = 5;

// The form's field names, and where each one is stored. The two names differ
// because the form was written first and the schema has its own vocabulary;
// neither is wrong, so the translation is listed here rather than assumed.
export const PRODUCT_FIELDS = Object.freeze({
  title: "name",
  description1: "description1",
  description2: "description2",
  warning: "warnings",
  type: "type",
  color: "color",
  weight: "weight",
  discount: "discount",
  sku: "SKU",
  stock_quantity: "stock",
  regular_price: "price",
  category: "category",
});

const text = (value) => String(value ?? "").trim();

// A number is a number and nothing else. `parseFloat` is not asked, because it
// reads "10kg" as 10 and the database would then be told a weight of "10kg",
// which it stores as no number at all.
const NUMERIC = /^-?\d+(\.\d+)?$/;

export const readNumber = (raw) => {
  const value = text(raw);
  if (value === "" || !NUMERIC.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
export const isObjectIdLike = (value) => OBJECT_ID.test(text(value));

// The price a shopper pays, from the price the product carries and the discount
// on it. It is worked out here so that the product list, the edit form and this
// form cannot each decide what a discount means: `priceAfterDiscount` is what
// the shopper's pages read, so leaving it unset leaves them reading nothing.
export const priceAfterDiscount = (price, discount) =>
  Math.max(0, Math.ceil(Number(price) * (1 - Number(discount) / 100)));

// The images a request carries, in the order the administrator arranged them.
//
// The form sends the picked files under `files` and the cropped versions under
// `croppedImage_0` .. `croppedImage_4`, and the cropped ones are what should be
// stored: they are the ones that were framed. A gap in the cropped list means a
// file the administrator did not crop, so the original is used for that position
// rather than the product silently losing the picture.
export const imagesFrom = (files = {}) => {
  const originals = Array.isArray(files.files) ? files.files : [];
  const images = [];

  for (let index = 0; index < IMAGES_PER_PRODUCT; index += 1) {
    const cropped = Array.isArray(files[`croppedImage_${index}`]) ? files[`croppedImage_${index}`] : [];
    const [file] = cropped.length ? cropped : originals.slice(index, index + 1);
    if (file?.path) {
      images.push(file.path);
    }
  }

  return images;
};

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Every field of the form is checked here, and each check says what was wrong
// with the value in the words the page shows beside the input. An administrator
// who mistyped a price is told about the price.
//
// Images are not part of this, because a product being created and a product
// being edited do not agree about them: the first has to be given its pictures,
// and the second already has some. The fields are the same either way, so they
// are read once here and each caller decides about the pictures.
export const readProductFields = (body = {}) => {
  const errors = {};
  const values = {};

  const name = text(body.title);
  if (name.length < 5) {
    errors.titleError = "Title is required and must be at least 5 characters long";
  } else if (name.length > 120) {
    errors.titleError = "Title must be 120 characters or fewer";
  } else {
    values.name = name;
  }

  const first = text(body.description1);
  if (first.length < 10) {
    errors.description1Error = "Description 1 is required and must be at least 10 characters long";
  } else {
    values.description1 = first;
  }

  // The second description is the long one, and the schema has it as optional:
  // a product with one description is a product the shop can sell, so it is
  // checked when it is given rather than demanded.
  const second = text(body.description2);
  if (second) {
    if (second.length < 10) {
      errors.description2Error = "Description 2 must be at least 10 characters long, or left empty";
    } else {
      values.description2 = second;
    }
  }

  const warning = text(body.warning);
  if (!warning) {
    errors.warningError = "Warning is required";
  } else {
    // Stored as `warnings`, which is what the schema calls it.
    values.warnings = warning;
  }

  const type = text(body.type);
  if (!type) {
    errors.typeError = "Type is required";
  } else {
    values.type = type;
  }

  const color = text(body.color);
  if (color) {
    values.color = color;
  }

  const weight = readNumber(body.weight);
  if (weight === null) {
    errors.weightError = "Weight is required and must be a number, in grams";
  } else if (weight <= 0) {
    errors.weightError = "Weight must be greater than 0";
  } else {
    values.weight = weight;
  }

  const discount = readNumber(body.discount);
  if (discount === null) {
    errors.discountError = "Discount is required and must be a number";
  } else if (discount < 0 || discount > 99) {
    errors.discountError = "Discount must be between 0 and 99";
  } else {
    values.discount = discount;
  }

  const sku = text(body.sku);
  if (!sku) {
    errors.skuError = "SKU is required";
  } else {
    values.SKU = sku;
  }

  const stock = readNumber(body.stock_quantity);
  if (stock === null) {
    errors.stock_quantityError = "Stock quantity is required and must be a whole number";
  } else if (!Number.isInteger(stock) || stock < 0) {
    errors.stock_quantityError = "Stock quantity must be a whole number of 0 or more";
  } else {
    values.stock = stock;
  }

  const price = readNumber(body.regular_price);
  if (price === null) {
    errors.regular_priceError = "Regular price is required and must be a number";
  } else if (price <= 0) {
    errors.regular_priceError = "Regular price must be greater than 0";
  } else {
    values.price = price;
  }

  const category = text(body.category);
  if (!category) {
    errors.categoryError = "Category is required";
  } else if (!isObjectIdLike(category)) {
    // A reference that is not an id cannot be stored at all, so it is refused
    // here rather than becoming a server error further in.
    errors.categoryError = "Choose a category from the list";
  } else {
    values.category = category;
  }

  if (values.price !== undefined && values.discount !== undefined) {
    values.priceAfterDiscount = priceAfterDiscount(values.price, values.discount);
  }

  return { values, errors };
};

// The fields of a product being created, plus the pictures it was created with.
// Everything is checked before anything is written, so a request this refuses
// leaves no product behind.
export const readProductForm = (body = {}, files = {}) => {
  const { values, errors } = readProductFields(body);

  const images = imagesFrom(files);
  if (images.length === 0) {
    errors.imageError = "Add at least 1 image";
  } else if (images.length > IMAGES_PER_PRODUCT) {
    errors.imageError = `A product can have at most ${IMAGES_PER_PRODUCT} images`;
  } else {
    values.images = images;
  }

  const imageError = imageTypeError(files);
  if (imageError) {
    errors.imageError = imageError;
  }

  return {
    ok: Object.keys(errors).length === 0,
    values,
    errors,
    images,
  };
};

// A file that is not an image is refused by name here as well as by the upload
// middleware, so the answer says which file was wrong.
const imageTypeError = (files = {}) => {
  for (const group of Object.values(files)) {
    for (const file of Array.isArray(group) ? group : []) {
      if (file?.mimetype && !IMAGE_TYPES.has(file.mimetype)) {
        return `${file.originalname ?? "One of the files"} is not a jpg, png or webp image`;
      }
    }
  }
  return null;
};

const asList = (value) => (Array.isArray(value) ? value : value === undefined || value === "" ? [] : [value]);

// What an edit says about the pictures a product already has.
//
// The form is not asked to repeat what it was already showing. It is asked which
// of the pictures the administrator is keeping, and a picture nobody kept is
// removed. That makes removal the thing an administrator does on purpose, rather
// than the thing that happens when a field is missing from a request.
//
// Two things are sent, because one is not enough. `knownImages` is the list the
// form was showing, and its presence is what says "this request is about the
// pictures" — an unticked checkbox is sent as nothing at all, so without it a
// form that unticked the only picture of a product would look exactly like a form
// that said nothing about pictures, and the removal would be silently ignored.
// `keepImages` is the ticked ones, and a picture the product does not hold cannot
// be kept, so a request cannot point a product at somebody else's picture.
export const imagesForEdit = (body = {}, files = {}, currentImages = []) => {
  const known = asList(body.knownImages).map(text).filter(Boolean);
  const asked = asList(body.keepImages).map(text).filter(Boolean);

  const knownToProduct = known.filter((path) => currentImages.includes(path));
  const kept = [];
  const unknown = [];

  for (const path of asked) {
    if (currentImages.includes(path)) {
      if (!kept.includes(path)) {
        kept.push(path);
      }
    } else {
      unknown.push(path);
    }
  }

  // A request that names no pictures at all is keeping all of them: they are
  // already there, and a request that does not mention them is a request about
  // something else. A request that names the pictures it was showing is an edit
  // of them, and unkeeping one is a decision.
  const retained = known.length > 0 ? kept : [...currentImages];

  const added = imagesFrom(files);
  const images = [...retained, ...added].slice(0, IMAGES_PER_PRODUCT);

  return {
    images,
    // What the form was showing that the product no longer has is not a removal
    // by the administrator; it is a picture that went away by some other means,
    // and it is left alone.
    removed: knownToProduct.filter((path) => !images.includes(path)),
    added,
    unknown,
  };
};

// The fields of a product being edited, plus what the request said about its
// pictures. `currentImages` is what the product holds now, which is the only
// thing a request is allowed to keep or remove.
export const readProductEditForm = (body = {}, files = {}, currentImages = []) => {
  const { values, errors } = readProductFields(body);
  const { images, removed, added, unknown } = imagesForEdit(body, files, currentImages);

  if (images.length === 0) {
    // A product with no picture is not a product this shop can sell, whichever
    // form asked for it.
    errors.imageError = "A product needs at least 1 image. Keep one, or add one.";
  } else {
    values.images = images;
  }

  const imageError = imageTypeError(files);
  if (imageError) {
    errors.imageError = imageError;
  }

  return {
    ok: Object.keys(errors).length === 0,
    values,
    errors,
    images,
    removed,
    added,
    unknown,
  };
};

// The values the form posted, in the names the form uses, so a page that
// re-renders after a mistake can show the administrator what they typed instead
// of an empty form. Only text is kept: a number that failed to parse is not
// carried back as a number.
export const formValues = (body = {}) => {
  const values = {};
  for (const key of Object.keys(PRODUCT_FIELDS)) {
    const value = text(body[key]);
    if (value) {
      values[key] = value;
    }
  }
  return values;
};

// The same, for a page that re-renders an existing product. Every field is
// included, and an empty one is included as empty, because there the fields the
// product already holds are what the page would show instead: a description the
// administrator cleared must come back cleared rather than filled in again from
// the product.
export const postedProductValues = (body = {}) => {
  const values = {};
  for (const key of Object.keys(PRODUCT_FIELDS)) {
    values[key] = text(body[key]);
  }
  return values;
};
