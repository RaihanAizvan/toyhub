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


const postBlockCoupon = async (req, res) => {
    const { id } = req.params;
    await Coupon.findByIdAndUpdate(id, { couponStatus: 'blocked' });
    res.redirect('/admin/coupons');
  };

const postDeleteCoupon = async (req, res) => {
    const { id } = req.params;
    await Coupon.findByIdAndDelete(id);
    res.redirect('/admin/coupons');
  };

const getEditCoupon = async (req, res) => {
    const { id } = req.params;
    const coupon = await Coupon.findById(id);
    res.render('admin/editCoupon', { coupon });
  };

const postEditCoupon = async (req, res) => {
    const { id } = req.params;
    const { couponCode, startDate, endDate, discount, discountType, usageCount } = req.body;
    await Coupon.findByIdAndUpdate(id, { couponCode, startDate, endDate, discount, discountType, usageCount });
    res.redirect('/admin/coupons');
  };



export default {
    getCoupon,
    getAddCoupon,
    postAddCoupon,
    postBlockCoupon,
    postDeleteCoupon,
    getEditCoupon,
    postEditCoupon
};