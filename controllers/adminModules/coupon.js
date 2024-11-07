import Coupon from '../../models/couponSchema.models.js';

const getCoupon =  async (req, res) => {
    const coupons = await Coupon.find({});
    res.render('admin/couponList', { coupons });
  };

const getAddCoupon = (req, res) => {
    res.render('admin/addCoupon');
  };

const postAddCoupon = async (req, res) => {
  const { couponCode, startDate, endDate, discount, discountType, usageLimit } = req.body;
  try {
    const newCoupon = new Coupon({ couponCode, startDate, endDate, discount, discountType, usageLimit });
    await newCoupon.save();
    res.redirect('/admin/coupons');
  } catch (error) {
    res.render('admin/addCoupon');
  }
  };

export default {
    getCoupon,
    getAddCoupon,
    postAddCoupon
};