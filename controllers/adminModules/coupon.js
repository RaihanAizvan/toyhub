import Coupon from '../../models/couponSchema.models.js';

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

const getAddCoupon = (req, res) => {
    res.render('admin/addCoupon');
  };

const postAddCoupon = async (req, res) => {
  let { couponCode, startDate, endDate, discount, discountType, usageLimit, minSpend } = req.body;
  couponCode = couponCode.toUpperCase();
  try {
    const newCoupon = new Coupon({ couponCode, startDate, endDate, discount, discountType, usageLimit, minSpend });
    await newCoupon.save();
    res.redirect('/admin/coupons');
  } catch (error) {
    res.render('admin/addCoupon',{error: error.message});
  }
  };

const getEditCoupon = async (req, res) => {
  const coupon = await Coupon.findById(req.params.id);
  res.render('admin/editCoupon', { coupon });
};

const postEditCoupon = async (req, res) => {
  try {
    let { couponCode, startDate, endDate, discount, discountType, usageLimit, minSpend } = req.body;
    couponCode = couponCode.toUpperCase();
    await Coupon.findByIdAndUpdate(req.params.id, { couponCode, startDate, endDate, discount, discountType, usageLimit, minSpend });
    res.redirect('/admin/coupons');
  } catch (error) {
    res.render('admin/editCoupon', { coupon: req.body, error: error.message });
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

