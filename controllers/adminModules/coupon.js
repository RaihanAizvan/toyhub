import Category from '../../models/categories.model.js';
import Coupon from '../../models/couponSchema.models.js';
import Product from '../../models/product.models.js';
import { isObjectId } from '../../utils/ownership.js';

// A coupon is a rule the shop writes down, so what the admin form sent is read
// as a rule and checked as one. A number that is not a number, a date that ends
// before it starts, and an id that is not a product or a category are all
// refused here rather than stored and discovered later at a checkout.
const readCoupon = (body) => {
  const couponCode = String(body.couponCode || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(couponCode)) {
    throw new Error('A coupon code is 2 to 32 letters, digits, dashes or underscores.');
  }

  const discountType = body.discountType === 'fixed' ? 'fixed' : 'percentage';
  const discount = Number(body.discount);
  if (!Number.isFinite(discount) || discount <= 0) {
    throw new Error('The discount has to be a number greater than zero.');
  }
  if (discountType === 'percentage' && discount > 90) {
    throw new Error('A percentage discount cannot be more than 90.');
  }

  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('A coupon needs a start date and an end date.');
  }
  if (endDate <= startDate) {
    throw new Error('The end date has to be after the start date.');
  }

  const usageLimit = Number(body.usageLimit);
  if (!Number.isInteger(usageLimit) || usageLimit < 1) {
    throw new Error('The usage limit has to be a whole number of one or more.');
  }

  const readNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  // Zero means no cap and no minimum, which is what leaving the field empty has
  // always meant.
  const maxDiscount = readNumber(body.maxDiscount);
  const minSpend = readNumber(body.minSpend);
  const minPurchase = readNumber(body.minPurchase);

  // A restriction only means something if it names something that exists.
  const readIds = (value) => {
    const raw = Array.isArray(value) ? value : [value];
    return raw.filter((entry) => entry && isObjectId(String(entry).trim())).map((entry) => String(entry).trim());
  };

  return {
    couponCode,
    timesUsed: 0,
    discount,
    discountType,
    startDate,
    endDate,
    usageLimit,
    maxDiscount,
    minSpend,
    minPurchase,
    applicableProducts: readIds(body.applicableProducts),
    applicableCategories: readIds(body.applicableCategories),
  };
};

// A restriction that names nothing that exists would quietly apply to nothing,
// which is a coupon the shop believes is running and no shopper can use.
const checkRestrictionsExist = async ({ applicableProducts, applicableCategories }) => {
  if (applicableProducts.length) {
    const found = await Product.countDocuments({ _id: { $in: applicableProducts } });
    if (found !== applicableProducts.length) {
      throw new Error('One of the products this coupon is limited to does not exist.');
    }
  }

  if (applicableCategories.length) {
    const found = await Category.countDocuments({ _id: { $in: applicableCategories } });
    if (found !== applicableCategories.length) {
      throw new Error('One of the categories this coupon is limited to does not exist.');
    }
  }
};

const getCoupon = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalCoupons = await Coupon.countDocuments({});
    const coupons = await Coupon.find({}).skip(skip).limit(limit);

    res.render('admin/couponList', {
        coupons,
        currentPage: page,
        totalPages: Math.ceil(totalCoupons / limit),
        totalCoupons
    });
};

const getAddCoupon = async (req, res) => {
    // The form can only offer products and categories that exist, so a coupon
    // is never written against an id that is not there.
    const [products, categories] = await Promise.all([
      Product.find({ isBlocked: false }).select('name').sort({ name: 1 }).lean(),
      Category.find({}).select('name').sort({ name: 1 }).lean(),
    ]);

    res.render('admin/addCoupon', { products, categories, error: null, coupon: null });
  };

const postAddCoupon = async (req, res) => {
  const [products, categories] = await Promise.all([
    Product.find({ isBlocked: false }).select('name').sort({ name: 1 }).lean(),
    Category.find({}).select('name').sort({ name: 1 }).lean(),
  ]);

  try {
    const rule = readCoupon(req.body);
    await checkRestrictionsExist(rule);
    await Coupon.create(rule);
    res.redirect('/admin/coupons');
  } catch (error) {
    res.render('admin/addCoupon', {
      products,
      categories,
      // What was typed is kept, so a rejected form can be corrected rather
      // than retyped.
      coupon: req.body,
      error: error.message,
    });
  }
  };

const getEditCoupon = async (req, res) => {
  const [coupon, products, categories] = await Promise.all([
    Coupon.findById(req.params.id),
    Product.find({ isBlocked: false }).select('name').sort({ name: 1 }).lean(),
    Category.find({}).select('name').sort({ name: 1 }).lean(),
  ]);
  res.render('admin/editCoupon', { coupon, products, categories, error: null });
};

const postEditCoupon = async (req, res) => {
  const [products, categories] = await Promise.all([
    Product.find({ isBlocked: false }).select('name').sort({ name: 1 }).lean(),
    Category.find({}).select('name').sort({ name: 1 }).lean(),
  ]);

  try {
    const rule = readCoupon(req.body);
    await checkRestrictionsExist(rule);

    // The form says how many uses are still going. What has already been spent
    // is kept as it is, because it was spent by real orders and rewriting that
    // number would let one of them be honoured twice.
    const current = await Coupon.findById(req.params.id);
    if (!current) {
      throw new Error('That coupon no longer exists.');
    }
    rule.timesUsed = Number(current.timesUsed) || 0;

    await Coupon.findByIdAndUpdate(req.params.id, rule);
    res.redirect('/admin/coupons');
  } catch (error) {
    res.render('admin/editCoupon', { coupon: req.body, products, categories, error: error.message });
  }
};

const postDeleteCoupon = async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.redirect('/admin/coupons');
  } catch (error) {
    res.status(500).send(error.message);
  }
};

const postBlockCoupon = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (coupon.isBlocked) {
      await Coupon.findByIdAndUpdate(req.params.id, { isBlocked: false });
    } else {
      await Coupon.findByIdAndUpdate(req.params.id, { isBlocked: true });
    }
    res.redirect('/admin/coupons');
  } catch (error) {
    res.status(500).send(error.message);
  }
};




export default {
    getCoupon,
    getAddCoupon,
    postAddCoupon,
    postEditCoupon,
    postDeleteCoupon,
    postBlockCoupon,
    getEditCoupon
};

