import Cart from '../models/cart.models.js';

import User from '../models/users.models.js';
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
  if (cart &&cart.items.some(item => item.product.stock <= 0)) {
    return res.status(400).redirect('/cart');
  }
  next();
}

export default {
  isUser,
  checkBlockStatus,
  redirectToLoginIfNotAUser,
  checkForProductStockBeforeCheckout
}
