import Cart from "../../models/cart.models.js";
import Product from "../../models/product.models.js";
import { isObjectId } from "../../utils/ownership.js";
import { refreshCartTotals } from "../../utils/cart-totals.js";

const MAX_QUANTITY_PER_ITEM = 10;
const MAX_LINES_PER_REQUEST = 50;

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

    const cart = (await findOwnCart(userId)) || new Cart({ user: userId, items: [] });

    for (const { product, quantity } of lines) {
      const productId = product._id.toString();
      const existingItemIndex = findItemIndex(cart, productId);

      if (existingItemIndex > -1) {
        const wanted =
          cart.items[existingItemIndex].quantity + quantity;
        if (wanted > MAX_QUANTITY_PER_ITEM) {
          return res.status(400).json({
            message: `At most ${MAX_QUANTITY_PER_ITEM} of a product can be in the cart`,
          });
        }
        cart.items[existingItemIndex].quantity = wanted;
      } else {
        // The document, not just the id: the totals helper prices the line
        // from it and the id is what gets stored.
        cart.items.push({
          product,
          quantity,
          price: product.price,
          discountPrice: product.discount,
          image: product.images?.[0],
        });
      }
    }

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

    // The price always comes from the product, never from the request.
    cart.items[itemIndex].quantity = quantity;
    cart.items[itemIndex].price = product.price;
    cart.items[itemIndex].discountPrice = product.discount;
    cart.items[itemIndex].product = product;

    await cart.save();
    await refreshCartTotals(cart);

    res.status(200).json({
      message: "Cart updated successfully",
      subtotal: cart.subtotal,
      total: cart.total,
      discount: cart.discount,
      offerDiscount: cart.offerDiscount,
      cutoffAmount: cart.cutoffAmount,
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
    await cart.save();
    await refreshCartTotals(cart);

    res.status(200).json({
      message: "Item removed from cart successfully",
      subtotal: cart.subtotal,
      total: cart.total,
      discount: cart.discount,
      cartItemCount: cart.items.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getCart = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return res.status(401).redirect("/user/login");
    }

    const cart = await Cart.findOne({ user: userId }).populate("items.product");
    if (!cart) {
      return res.render("user/cart", {
        title: "Cart",
        user: req.session.user,
        cart: { items: [] },
      });
    }

    const cartItemsWithDetails = cart.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      price: item.price,
      discountPrice: item.discountPrice,
    }));

    res.render("user/cart", {
      title: "Cart",
      user: req.session.user,
      name: req.session.user?.name,
      cart: {
        ...cart.toObject(),
        items: cartItemsWithDetails,
      },
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
};
