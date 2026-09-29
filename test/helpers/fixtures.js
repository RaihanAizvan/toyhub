import bcrypt from "bcrypt";
import mongoose from "mongoose";
import Address from "../../models/address.models.js";
import AdminUser from "../../models/admin.models.js";
import Cart from "../../models/cart.models.js";
import CouponRedemption from "../../models/coupon-redemptions.models.js";
import Category from "../../models/categories.model.js";
import Coupon from "../../models/couponSchema.models.js";
import Offer from "../../models/offers.models.js";
import Order from "../../models/orders.models.js";
import Product from "../../models/product.models.js";
import Rating from "../../models/ratings.models.js";
import User from "../../models/users.models.js";
import Wallet from "../../models/wallets.models.js";
import Wishlist from "../../models/wishlist.models.js";

const SALT_ROUNDS = 4;

let sequence = 0;

const unique = (prefix) =>
  `${prefix}-${process.pid.toString(36)}-${(sequence++).toString(36)}`;

const uniqueEmail = (prefix) => `${prefix}.${unique("id")}@example.invalid`;

export const objectId = (value) => {
  if (value === undefined || value === null || value === "") {
    return new mongoose.Types.ObjectId();
  }
  return value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));
};

export const resetFixtureSequence = () => {
  sequence = 0;
};

export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

const isBcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);

const withHashedPassword = async (doc) => {
  if (doc.password && !isBcryptHash(doc.password)) {
    return { ...doc, password: await hashPassword(doc.password) };
  }
  return doc;
};

const daysFromNow = (days) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

export const buildUser = (overrides = {}) => ({
  name: "Test User",
  email: uniqueEmail("user"),
  phone_number: "9000000000",
  password: "TestPassw0rd!",
  verified: true,
  isBlocked: false,
  totalProductsBuyed: 0,
  totalAmoutSpended: 0,
  ...overrides,
});

export const createUser = async (overrides = {}) =>
  User.create(await withHashedPassword(buildUser(overrides)));

export const buildBlockedUser = (overrides = {}) =>
  buildUser({ isBlocked: true, ...overrides });

export const buildAdmin = (overrides = {}) => ({
  username: "Test Admin",
  password: "TestAdminPassw0rd!",
  role: "admin",
  email: uniqueEmail("admin"),
  ...overrides,
});

export const createAdmin = async (overrides = {}) =>
  AdminUser.create(await withHashedPassword(buildAdmin(overrides)));

export const buildCategory = (overrides = {}) => ({
  name: `Test Category ${unique("cat")}`,
  isActive: true,
  image: "https://example.invalid/category.png",
  ...overrides,
});

export const createCategory = async (overrides = {}) =>
  Category.create(buildCategory(overrides));

export const buildProduct = (overrides = {}) => ({
  name: `Test Product ${unique("prod")}`,
  type: "toy",
  description1: "A product used by the automated test suite.",
  price: 500,
  stock: 25,
  sold: 0,
  category: objectId(),
  images: ["https://example.invalid/product.png"],
  ...overrides,
});

export const createProduct = async (overrides = {}) => {
  const product = buildProduct(overrides);
  if (!mongoose.isValidObjectId(product.category) || !product.category) {
    product.category = (await createCategory())._id;
  }
  return Product.create(product);
};

export const buildAddress = (overrides = {}) => ({
  user: objectId(),
  name: "Test Recipient",
  street: "1 Test Street",
  city: "Testville",
  state: "Teststate",
  zip: "400001",
  phone: 9000000000,
  ...overrides,
});

export const createAddress = async (overrides = {}) =>
  Address.create(buildAddress(overrides));

export const buildCartItem = (overrides = {}) => ({
  product: objectId(),
  quantity: 1,
  price: 500,
  discountPrice: 500,
  ...overrides,
});

export const buildCart = (overrides = {}) => ({
  user: objectId(),
  items: [],
  discount: 0,
  offerDiscount: 0,
  couponDiscount: 0,
  cutoffAmount: 0,
  appliedCoupon: null,
  subtotal: 0,
  total: 0,
  ...overrides,
});

export const createCart = async (overrides = {}) => {
  const cart = buildCart(overrides);
  cart.user = objectId(cart.user);
  if (!mongoose.isValidObjectId(cart.user)) {
    cart.user = (await createUser())._id;
  }
  cart.items = cart.items.map((item) => ({
    ...item,
    product: objectId(item.product),
  }));
  cart.subtotal = cart.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  cart.total = cart.subtotal - cart.couponDiscount - cart.offerDiscount;
  return Cart.create(cart);
};

// A coupon the suite can actually use: a running code, a number of uses still
// going, and no cap unless a test asks for one.
export const buildCoupon = (overrides = {}) => ({
  couponCode: unique("CPN").toUpperCase(),
  discount: 10,
  discountType: "percentage",
  minSpend: 0,
  minPurchase: 0,
  maxDiscount: 0,
  usageLimit: 5,
  startDate: daysFromNow(-1),
  endDate: daysFromNow(30),
  isBlocked: false,
  ...overrides,
});

export const createCoupon = async (overrides = {}) =>
  Coupon.create(buildCoupon(overrides));

export const buildCouponRedemption = (overrides = {}) => ({
  coupon: objectId(),
  couponCode: unique("CPN").toUpperCase(),
  user: objectId(),
  order: objectId(),
  amount: 0,
  ...overrides,
});

export const createCouponRedemption = async (overrides = {}) => {
  const redemption = buildCouponRedemption(overrides);
  redemption.coupon = objectId(redemption.coupon);
  redemption.user = objectId(redemption.user);
  redemption.order = objectId(redemption.order);
  return CouponRedemption.create(redemption);
};

export const buildOffer = (overrides = {}) => ({
  name: `Test Offer ${unique("offer")}`,
  offerType: "all",
  offerPercentage: 10,
  startDate: daysFromNow(-1),
  endDate: daysFromNow(30),
  isBlocked: false,
  ...overrides,
});

export const createOffer = async (overrides = {}) =>
  Offer.create(buildOffer(overrides));

export const buildOrderItem = (overrides = {}) => ({
  product: objectId(),
  quantity: 1,
  price: 500,
  paymentMethod: "cod",
  ...overrides,
});

export const buildOrderAddress = (overrides = {}) => ({
  user: {
    name: "Test User",
    email: uniqueEmail("buyer"),
    phone_number: 9000000000,
  },
  name: "Test Recipient",
  street: "1 Test Street",
  city: "Testville",
  state: "Teststate",
  zip: "400001",
  phone: 9000000000,
  ...overrides,
});

export const buildOrder = (overrides = {}) => ({
  user: objectId(),
  items: [buildOrderItem()],
  totalAmount: 500,
  discount: 0,
  offerDiscount: 0,
  couponDiscount: 0,
  cutoffAmount: 0,
  subtotal: 500,
  address: buildOrderAddress(),
  paymentMethod: "cod",
  paid: false,
  couponCode: null,
  status: "pending",
  ...overrides,
});

export const createOrder = async (overrides = {}) => {
  const order = buildOrder(overrides);
  order.user = objectId(order.user);
  if (!mongoose.isValidObjectId(order.user)) {
    order.user = (await createUser())._id;
  }
  order.items = order.items.map((item) => ({
    ...item,
    product: objectId(item.product),
  }));
  return Order.create(order);
};

export const buildPayment = (overrides = {}) => ({
  method: "razorpay",
  razorpayOrderId: `order_${unique("rzp")}`,
  razorpayPaymentId: `pay_${unique("rzp")}`,
  razorpaySignature: `sig_${unique("rzp")}`,
  amount: 500,
  paid: true,
  ...overrides,
});

// A wallet holds the balance and nothing else, so a fixture cannot claim a
// history that the ledger does not have.
export const buildWallet = (overrides = {}) => ({
  user: objectId(),
  balance: 0,
  ...overrides,
});

export const createWallet = async (overrides = {}) => {
  const wallet = buildWallet(overrides);
  wallet.user = objectId(wallet.user);
  if (!mongoose.isValidObjectId(wallet.user)) {
    wallet.user = (await createUser())._id;
  }
  return Wallet.create(wallet);
};

export const buildRating = (overrides = {}) => ({
  productId: objectId(),
  userId: objectId(),
  rating: 5,
  title: "Test review",
  comment: "A review created by the automated test suite.",
  status: "approved",
  isVerifiedPurchase: true,
  helpfulVotes: 0,
  ...overrides,
});

export const createRating = async (overrides = {}) =>
  Rating.create(buildRating(overrides));

export const buildWishlist = (overrides = {}) => ({
  userId: objectId(),
  wishlist: [],
  ...overrides,
});

export const createWishlist = async (overrides = {}) =>
  Wishlist.create(buildWishlist(overrides));

export const fixtures = {
  buildUser,
  createUser,
  buildBlockedUser,
  buildAdmin,
  createAdmin,
  buildCategory,
  createCategory,
  buildProduct,
  createProduct,
  buildAddress,
  createAddress,
  buildCartItem,
  buildCart,
  createCart,
  buildCoupon,
  createCoupon,
  buildCouponRedemption,
  createCouponRedemption,
  buildOffer,
  createOffer,
  buildOrderItem,
  buildOrderAddress,
  buildOrder,
  createOrder,
  buildPayment,
  buildWallet,
  createWallet,
  buildRating,
  createRating,
  buildWishlist,
  createWishlist,
  objectId,
  hashPassword,
  resetFixtureSequence,
};

export default fixtures;
