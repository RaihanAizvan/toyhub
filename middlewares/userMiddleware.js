import Cart from '../models/cart.models.js';
import Offer from '../models/offers.models.js';
import User from '../models/users.models.js';
import Coupon from '../models/couponSchema.models.js';
function isUser(req, res, next) {
  if (req.session.user) {
    next()
  } else {
    res.status(403).send("Access denied. not authenticated.")
  }
}
const checkBlockStatus = async (req, res, next) => {
  try {
    if (req.session.user) {
      const userId = req.session.user._id;
      const user = await User.findById(userId);

      if (user && user.isBlocked) {
        // Destroy the session
        req.session.destroy((err) => {
          if (err) {
            console.error('Error destroying session:', err);
          }
          // Redirect to login with a message
          return res.redirect('/login?message=Your account has been blocked. Please contact support.');
        });
      } else {
        next();
      }
    } else {
      next();
    }
  } catch (error) {
    console.error('Error checking block status:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
const redirectToLoginIfNotAUser = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(403).redirect("/user/login");
    console.log("not a user");
  }
}

const checkForProductStockBeforeCheckout = async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
  if (cart && cart.items.some(item => item.product.stock <= 0)) {
    return res.status(400).redirect('/cart');
  }
  next();
}

const updateOfferDiscountInCart = async (req, res, next) => {
  console.log(' entered update offer discount in cart')
  try {
    let cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
    if (!cart) {
      cart = new Cart({ items: [], user: req.session.user?.id });
    }

    cart.offerDiscount = 0;
    cart.subtotal = 0;
    cart.discount = 0;

    if (cart.items.length > 0) {
      for (const item of cart.items) {
        const product = item.product;
        const offers = await Offer.find({
          $or: [
            { applicableProducts: product._id },
            { applicableCategories: product.category }
          ]
        });

        const offerDiscountPerUnit = offers.reduce((acc, curr) => {
          return acc + (curr.offerPercentage ? (product.price * curr.offerPercentage) / 100 : 0);
        }, 0);

        const totalItemOfferDiscount = offerDiscountPerUnit * item.quantity;
        item.offerDiscount = totalItemOfferDiscount;
        cart.offerDiscount += totalItemOfferDiscount;

        const itemSubtotal = product.price * item.quantity;
        cart.subtotal += itemSubtotal;

        // Update discount based on product's discount
        const productDiscount = (product.price * item.quantity * product.discount) / 100;
        cart.discount += productDiscount;
      }
    }
    
    cart.total = (cart.subtotal - cart.discount - cart.offerDiscount - cart.couponDiscount).toFixed(2);

    // Apply cutoff logic
    const cutoffAmount = cart.subtotal * 0.20;
    if (cart.total < cutoffAmount) {
      cart.cutoffAmount = cutoffAmount - cart.total;
      cart.total = cutoffAmount.toFixed(2);
    } else {
      cart.cutoffAmount = 0;
    }
    await cart.save();
    next();
  } catch (error) {
    console.error('Error updating offer discount in cart:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
  

};

const updateCouponDiscountInCheckout = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.session.user.id });
    if (!cart) {
      return res.status(400).json({ message: 'Cart not found' });
    }

    // Store the original total before applying any coupon
    const originalTotal = cart.subtotal - cart.discount - cart.offerDiscount - cart.couponDiscount;

    // Apply coupon discount if available
    let couponDiscount = 0;
    if (req.body.couponCode) {
      const coupon = await Coupon.findOne({ couponCode: req.body.couponCode });
      if (coupon && !coupon.isBlocked && coupon.usageLimit > 0) {
        if (coupon.discountType === 'percentage') {
          couponDiscount = (originalTotal * coupon.discount) / 100;
        } else if (coupon.discountType === 'fixed') {
          couponDiscount = coupon.discount;
        }
      }
    }

    // Calculate the total after applying the coupon discount and cutoff amount
    const totalAfterDiscount = originalTotal - couponDiscount;
    cart.total = (totalAfterDiscount + cart.cutoffAmount).toFixed(2);

    await cart.save();
    next();
  } catch (error) {
    console.error('Error updating coupon discount in checkout:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

export default {
  isUser,
  checkBlockStatus,
  redirectToLoginIfNotAUser,
  checkForProductStockBeforeCheckout,
  updateOfferDiscountInCart,
  updateCouponDiscountInCheckout
}
