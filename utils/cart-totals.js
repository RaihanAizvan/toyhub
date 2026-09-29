import Offer from "../models/offers.models.js";

// One place that turns the items of a populated cart into money. Every cart
// read and every cart mutation goes through here, so a quantity change can
// never leave a stale total behind, and the price of a line is always the
// price of the product rather than anything the request supplied.
//
// The cart has to be populated with items.product.
export const refreshCartTotals = async (cart) => {
  cart.offerDiscount = 0;
  cart.subtotal = 0;
  cart.discount = 0;
  cart.excludedAmount = 0;

  for (const item of cart.items) {
    const product = item.product;
    if (!product) {
      // A line whose product has been deleted is kept so the shopper can see
      // why it is there, but it is not money and cannot be bought.
      item.available = false;
      item.unavailableReason = "This product is no longer available";
      item.price = 0;
      item.discountPrice = 0;
      item.offerDiscount = 0;
      continue;
    }

    // A product with no discount set has an absent one, not a broken one, so
    // the line is stored as a number either way.
    item.price = product.price;
    item.discountPrice = Number(product.discount) || 0;
    item.image = product.images?.[0] ?? null;

    // A line that cannot be bought is priced, so the shopper can see the
    // saving they are giving up, but it is not part of the money.
    if (product.isBlocked) {
      item.available = false;
      item.unavailableReason = "This product is no longer available";
    } else if (Number(product.stock) < 1) {
      item.available = false;
      item.unavailableReason = "This product is out of stock";
    } else if (Number(product.stock) < item.quantity) {
      item.available = false;
      item.unavailableReason = `Only ${product.stock} of this product are left`;
    } else {
      item.available = true;
      item.unavailableReason = null;
    }

    // A line that cannot be bought is still shown, with its price, so the
    // shopper can see what they are giving up, but it is not money: the cart
    // total never counts something that cannot be bought. The amount it would
    // have been is reported on its own, so the summary can say so rather than
    // quietly not adding up.
    if (!item.available) {
      item.offerDiscount = 0;
      cart.excludedAmount += product.price * item.quantity;
      continue;
    }

    const offers = await Offer.find({
      $or: [
        { applicableProducts: product._id },
        { applicableCategories: product.category },
      ],
    });

    const offerPerUnit = offers.reduce(
      (acc, offer) =>
        acc + (offer.offerPercentage ? (product.price * offer.offerPercentage) / 100 : 0),
      0,
    );

    item.offerDiscount = offerPerUnit * item.quantity;
    cart.offerDiscount += item.offerDiscount;
    cart.subtotal += product.price * item.quantity;
    // A product without a discount rate is a product without a discount.
    const discountRate = Number(product.discount) || 0;
    cart.discount += (product.price * item.quantity * discountRate) / 100;
  }

  cart.total = (
    cart.subtotal - cart.discount - cart.offerDiscount - (cart.couponDiscount || 0)
  ).toFixed(2);

  // The shop only earns on a fifth of the subtotal, so smaller carts carry a cutoff.
  const cutoffAmount = cart.subtotal * 0.2;
  if (cart.total < cutoffAmount) {
    cart.cutoffAmount = cutoffAmount - cart.total;
    cart.total = cutoffAmount.toFixed(2);
  } else {
    cart.cutoffAmount = 0;
  }

  await cart.save();

  return cart;
};
