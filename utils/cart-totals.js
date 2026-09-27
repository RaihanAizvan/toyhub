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

  for (const item of cart.items) {
    const product = item.product;
    if (!product) {
      continue;
    }

    item.price = product.price;
    item.discountPrice = product.discount;

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
