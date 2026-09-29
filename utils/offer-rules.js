import Offer from "../models/offers.models.js";

// Whether an offer applies to a product is asked in three places that did not
// agree: the cart added up every offer that mentioned a product or its
// category, the product page printed a list the view picked from, and the
// checkout page printed every offer in the shop. So an offer on everything
// matched nothing at all, an expired one still came off the price, and two
// offers meant 40% rather than the better 20%.
//
// This is the one answer. An offer applies to a product when it is not blocked,
// today is inside its window, and the product is one it names: either
// explicitly, or through the product's category, or because the offer is for
// the whole shop.

const OFFER_TYPES = ["product", "category", "all"];

// The shop form posts ids as strings and the product stores them as ObjectIds,
// so every comparison here is made on the string form. One format, one
// comparison, no matter which side a value came from.
const idSet = (ids) => new Set((ids ?? []).map(String));

// An offer that names nothing is an offer for the whole shop, whatever the type
// says. A shop-wide offer is written with empty reference lists, and reading
// those lists literally is how "applies to everything" became "applies to
// nothing".
const coversWholeShop = (offer) => offer.offerType === "all";

// Whether an offer is live right now. A missing date on either end means the
// offer is not bounded that way, which is what an unset date has always meant.
export const isOfferLive = (offer, now = new Date()) => {
  if (offer.isBlocked) {
    return false;
  }

  if (offer.startDate && new Date(offer.startDate) > now) {
    return false;
  }

  if (offer.endDate && new Date(offer.endDate) < now) {
    return false;
  }

  return true;
};

const liveFilter = (now = new Date()) => ({
  isBlocked: false,
  $and: [
    { $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }] },
    { $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }] },
  ],
});

// Every live offer that names a product. Product ids are compared as strings so
// an ObjectId in the list and a string in the query mean the same thing.
export const offersForProduct = async (product, { now = new Date() } = {}) => {
  if (!product?._id) {
    return [];
  }

  const categoryId = product.category?._id ?? product.category;

  return Offer.find(
    {
      ...liveFilter(now),
      $or: [
        { offerType: "all" },
        { applicableProducts: { $in: [product._id, String(product._id)] } },
        ...(categoryId
          ? [{ applicableCategories: { $in: [categoryId, String(categoryId)] } }]
          : []),
      ],
    },
  ).sort({ offerPercentage: -1, _id: 1 });
};

// The offers that can be told about on a page: live, and claiming something on
// the cart. An offer the shopper cannot use is not worth printing.
export const offersForCart = async (cart, { now = new Date() } = {}) => {
  // Nothing to buy is nothing to offer. A cart with no lines is not shown the
  // whole shop's offers.
  if (!cart?.items?.length) {
    return [];
  }

  const live = await Offer.find(liveFilter(now)).sort({ offerPercentage: -1, _id: 1 });
  if (!live.length) {
    return [];
  }

  const products = new Set(
    (cart?.items ?? []).map((item) => item.product?._id).filter(Boolean).map(String),
  );
  const categories = new Set(
    (cart?.items ?? [])
      .map((item) => item.product?.category?._id ?? item.product?.category)
      .filter(Boolean)
      .map(String),
  );

  return live.filter((offer) => {
    if (coversWholeShop(offer)) {
      return true;
    }
    const named = idSet(offer.applicableProducts);
    const namedCategories = idSet(offer.applicableCategories);
    for (const id of products) {
      if (named.has(id)) {
        return true;
      }
    }
    for (const id of categories) {
      if (namedCategories.has(id)) {
        return true;
      }
    }
    return false;
  });
};

// When more than one offer names a product, the shopper gets the best one, not
// all of them. A discount is a discount: two offers do not add up to more off
// than the largest of them, which is what summing them did.
export const bestOfferFor = (product, offers, { now = new Date() } = {}) => {
  if (!product) {
    return null;
  }

  const categoryId = product.category?._id ?? product.category;

  const eligible = (offers ?? []).filter((offer) => {
    if (!isOfferLive(offer, now)) {
      return false;
    }
    if (coversWholeShop(offer)) {
      return true;
    }
    if (idSet(offer.applicableProducts).has(String(product._id))) {
      return true;
    }
    return categoryId ? idSet(offer.applicableCategories).has(String(categoryId)) : false;
  });

  if (!eligible.length) {
    return null;
  }

  // Ties go to the older offer, so the same cart prices the same way twice and
  // the order of rows in the database cannot change what a shopper pays.
  return eligible.reduce((best, offer) => {
    if (!best) {
      return offer;
    }
    const bestRate = Number(best.offerPercentage) || 0;
    const rate = Number(offer.offerPercentage) || 0;
    if (rate !== bestRate) {
      return rate > bestRate ? offer : best;
    }
    return String(offer._id) < String(best._id) ? offer : best;
  }, null);
};

// What the best offer is worth on a product, for one unit. A discount is never
// worth more than the thing it is discounting, so a line can never go negative
// however generous the shop was.
export const offerDiscountForUnit = (product, offer) => {
  if (!product || !offer) {
    return 0;
  }

  const price = Number(product.price) || 0;
  const raw = (price * (Number(offer.offerPercentage) || 0)) / 100;
  return Math.min(Math.max(raw, 0), price);
};

// The name and percentage an offer can be shown by, for a product. Null when no
// offer applies, so a page asks one question instead of working it out again.
export const offerForDisplay = (product, offers, options) => {
  const offer = bestOfferFor(product, offers, options);
  if (!offer) {
    return null;
  }

  return {
    _id: offer._id,
    name: offer.name,
    description: offer.description ?? "",
    offerPercentage: Number(offer.offerPercentage) || 0,
    endDate: offer.endDate ?? null,
  };
};

export { OFFER_TYPES, coversWholeShop, idSet, liveFilter };
