import Cart from '../models/cart.models.js';
import User from '../models/users.models.js';
import Coupon from '../models/couponSchema.models.js';
import { clearSessionCookie } from '../utils/session.js';
import { refreshCartTotals } from '../utils/cart-totals.js';
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
      const userId = req.session.user.id;
      const user = await User.findById(userId);

      if (user && user.isBlocked) {
        // Destroy the session
        req.session.destroy((err) => {
          if (err) {
            console.error('Error destroying session:', err.message);
          }
          clearSessionCookie(res);
          // Redirect to login with a message
          return res.redirect('/user/login?blocked=1');
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
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      // If the request is likely from Axios, send a JSON response
      res.status(403).json({ message: 'Unauthorized' });
    } else {
      // Otherwise, redirect to the login page
      res.status(403).redirect("/user/login");
    }
  }
}




// Only the checkout page is turned away, and only when a line really cannot be
// bought. A line whose product is gone is not a reason to read a property of
// nothing, which used to answer every checkout with a server error, and the
// order handlers do not need this at all: they price the cart themselves and
// say what is wrong with it in the response.
const checkForProductStockBeforeCheckout = async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(403).redirect('/user/login');
  }

  try {
    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    const unbuyable = cart?.items.some(
      (item) => !item.product || item.product.stock < 1,
    );

    if (unbuyable) {
      return res.status(400).redirect('/cart');
    }

    next();
  } catch (error) {
    // A cart that cannot be read must not keep the shopper off the page: the
    // page and the handlers both report what is actually wrong.
    console.error('Error checking cart before checkout:', error);
    next();
  }
}

const updateOfferDiscountInCart = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(400).redirect('/user/login');
    }
    const cart = await Cart.findOne({ user: userId }).populate('items.product');

    // An account that has never had a cart has nothing to price, and simply
    // looking at the page must not leave an empty document behind for it.
    if (!cart) {
      return next();
    }

    // The totals of a cart are only ever derived here, so reads and mutations
    // cannot drift apart.
    await refreshCartTotals(cart);
    next();
  } catch (error) {
    console.error('Error updating offer discount in cart:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

// The coupon that applies is the one on the cart, put there by the shopper
// asking for it. A code arriving with this request is not applied here, and the
// total is left to refreshCartTotals, which is the only place that derives one.
const updateCouponDiscountInCheckout = async (req, res, next) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) {
      return res.status(403).redirect('/user/login');
    }

    const cart = await Cart.findOne({ user: userId }).populate('items.product');
    if (!cart) {
      return next();
    }

    if (cart.appliedCoupon) {
      const coupon = await Coupon.findOne({ couponCode: cart.appliedCoupon });
      if (!coupon || coupon.isBlocked || coupon.usageLimit <= 0) {
        cart.appliedCoupon = null;
        cart.couponDiscount = 0;
      }
    }

    await refreshCartTotals(cart);
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
