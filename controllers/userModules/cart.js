import Cart from "../../models/cart.models.js";
import Product from "../../models/product.models.js";
import { isObjectId } from "../../utils/ownership.js";
import { refreshCartTotals } from "../../utils/cart-totals.js";

const MAX_QUANTITY_PER_ITEM = 10;
const MAX_LINES_PER_CART = 50;
const MAX_LINES_PER_REQUEST = 50;

// The shape the view draws. An account with no cart yet gets the same numbers
// as an account whose cart was emptied, so a page never has to ask whether a
// cart is there before reading a total off it.
export const emptyCart = (userId) => ({
  _id: null,
  user: userId ?? null,
  items: [],
  discount: 0,
  offerDiscount: 0,
  couponDiscount: 0,
  subtotal: 0,
  excludedAmount: 0,
  total: 0,
  cutoffAmount: 0,
  appliedCoupon: null,
});

const requireUserId = (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return String(userId);
};

// A quantity is a whole number in a known range. Anything else, including a
// fraction, a word or an array, is refused rather than quietly rounded.
const parseQuantity = (value) => {
  if (typeof value !== "number" && typeof value !== "string") {
    return null;
  }

  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ITEM) {
    return null;
  }
  return quantity;
};

// The cart is always the one that belongs to the session user. A cart id from
// the request is never used to look a cart up, so a guess cannot reach another
// account, and an unknown cart answers exactly like somebody else's cart.
const findOwnCart = (userId) =>
  Cart.findOne({ user: userId }).populate("items.product");

// The same, but the account is given a cart to work on whether or not one is
// stored yet. Nothing is written until a change is actually made.
const ownCartForChange = async (userId) => {
  const existing = await findOwnCart(userId);
  return existing ?? new Cart({ user: userId, items: [] });
};

// What the view is given, and what an empty cart is given, is the same shape.
const cartForView = (cart, userId) => {
  if (!cart) {
    return emptyCart(userId);
  }

  return {
    ...cart.toObject(),
    // The lines a shopper cannot buy are drawn with their price and are not
    // in the totals, so the page says what they are worth on their own.
    unavailableItemCount: cart.items.filter((item) => item.available === false).length,
    items: cart.items.map((item) => ({
      // A line whose product has gone still renders, with the reason on it.
      product: item.product ?? null,
      productId: lineProductId(item),
      quantity: item.quantity,
      price: Number(item.price) || 0,
      discountPrice: Number(item.discountPrice) || 0,
      offerDiscount: Number(item.offerDiscount) || 0,
      image: item.image ?? item.product?.images?.[0] ?? null,
      available: item.available !== false,
      unavailableReason: item.unavailableReason ?? null,
      lineTotal: (Number(item.price) || 0) * item.quantity,
    })),
  };
};

// A populated line carries the product document, an unpopulated one only the
// id, so the id is read the same way in both cases.
const lineProductId = (item) => String(item.product?._id ?? item.product);

const findItemIndex = (cart, productId) =>
  cart.items.findIndex((item) => lineProductId(item) === String(productId));

export const postAddProductToCart = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "A list of products is required" });
    }
    if (products.length > MAX_LINES_PER_REQUEST) {
      return res.status(400).json({ message: "Too many products in one request" });
    }

    const lines = [];
    for (const entry of products) {
      const productId = entry?.productId;
      const quantity = parseQuantity(entry?.quantity ?? 1);

      if (!isObjectId(productId) || quantity === null) {
        return res.status(400).json({ message: "Invalid product or quantity" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      lines.push({ product, quantity });
    }

    const cart = await ownCartForChange(userId);

    // Everything is checked before anything is written, so a refused request
    // leaves the cart exactly as it was. Each planned line carries the product
    // it belongs to, so the saved cart is the documented shape rather than a
    // half-edited document.
    const planned = cart.items.map((item) => ({
      productId: lineProductId(item),
      quantity: item.quantity,
      product: item.product,
    }));

    for (const { product, quantity } of lines) {
      const productId = product._id.toString();
      const existing = planned.find((line) => line.productId === productId);

      if (existing) {
        const wanted = existing.quantity + quantity;
        if (wanted > MAX_QUANTITY_PER_ITEM) {
          return res.status(400).json({
            message: `At most ${MAX_QUANTITY_PER_ITEM} of a product can be in the cart`,
          });
        }
        if (wanted > Number(product.stock)) {
          return res.status(409).json({
            message: `Only ${product.stock} of ${product.name} are left`,
          });
        }
        existing.quantity = wanted;
        existing.product = product;
        continue;
      }

      if (planned.length >= MAX_LINES_PER_CART) {
        return res.status(400).json({
          message: `A cart can hold at most ${MAX_LINES_PER_CART} different products`,
        });
      }

      if (quantity > Number(product.stock)) {
        return res.status(409).json({
          message: `Only ${product.stock} of ${product.name} are left`,
        });
      }

      planned.push({ productId, quantity, product });
    }

    // A line whose product has been deleted is kept exactly as it was, so
    // adding something else never quietly removes the line that tells the
    // shopper what went wrong.
    cart.items = planned.map((line) => ({
      product: line.product,
      quantity: line.quantity,
      price: line.product?.price ?? 0,
      discountPrice: line.product?.discount ?? 0,
      offerDiscount: 0,
      image: line.product?.images?.[0] ?? null,
    }));

    await refreshCartTotals(cart);

    res.status(200).json({
      message: "Product added to cart successfully",
      cartItemCount: cart.items.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const updateQuantity = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const { productId } = req.body;
    const quantity = parseQuantity(req.body?.quantity);

    if (!isObjectId(productId) || quantity === null) {
      return res.status(400).json({ message: "Invalid product or quantity" });
    }

    const cart = await findOwnCart(userId);
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const itemIndex = findItemIndex(cart, productId);
    if (itemIndex === -1) {
      return res.status(404).json({ message: "Product not in cart" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (quantity > Number(product.stock)) {
      return res.status(409).json({
        message: `Only ${product.stock} of ${product.name} are left`,
      });
    }

    // The price always comes from the product, never from the request.
    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].product = product;

    await refreshCartTotals(cart);

    res.status(200).json({
      message: "Cart updated successfully",
      subtotal: cart.subtotal,
      total: cart.total,
      discount: cart.discount,
      offerDiscount: cart.offerDiscount,
      couponDiscount: cart.couponDiscount,
      cutoffAmount: cart.cutoffAmount,
      cartItemCount: cart.items.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const postRemoveItemFromCartHandler = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const { productId } = req.body;
    if (!isObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product" });
    }

    const cart = await findOwnCart(userId);
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const itemToRemove = cart.items.find((item) => lineProductId(item) === String(productId));
    if (!itemToRemove) {
      return res.status(404).json({ message: "Product not in cart" });
    }

    cart.items = cart.items.filter((item) => lineProductId(item) !== String(productId));

    // A coupon is judged against what is in the cart, so an emptied cart has
    // nothing left for it to be worth.
    if (cart.items.length === 0) {
      cart.appliedCoupon = null;
      cart.couponDiscount = 0;
    }

    await refreshCartTotals(cart);

    res.status(200).json({
      message: "Item removed from cart successfully",
      subtotal: cart.subtotal,
      total: cart.total,
      discount: cart.discount,
      offerDiscount: cart.offerDiscount,
      couponDiscount: cart.couponDiscount,
      cutoffAmount: cart.cutoffAmount,
      cartItemCount: cart.items.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// Emptying the cart is a change like any other: the lines go, the coupon goes
// with them, and the totals are priced again so nothing is left behind.
export const postClearCart = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const cart = await findOwnCart(userId);
    if (!cart) {
      return res.status(200).json({
        message: "Your cart is already empty",
        cart: emptyCart(userId),
      });
    }

    cart.items = [];
    cart.appliedCoupon = null;
    cart.couponDiscount = 0;
    await refreshCartTotals(cart);

    return res.status(200).json({
      message: "Cart cleared",
      cartItemCount: 0,
      subtotal: cart.subtotal,
      total: cart.total,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getCart = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return res.status(401).redirect("/user/login");
    }

    const cart = await findOwnCart(userId);

    // The totals are priced again as the page is drawn, so what the shopper
    // reads is what the products say now and not what they were at some point.
    if (cart) {
      await refreshCartTotals(cart);
    }

    res.render("user/cart", {
      title: "Cart",
      user: req.session.user,
      name: req.session.user?.name,
      cart: cartForView(cart, userId),
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
};

export default {
  getCart,
  postAddProductToCart,
  updateQuantity,
  postRemoveItemFromCartHandler,
  postClearCart,
};
