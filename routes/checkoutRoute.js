import * as checkout from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js";
import express from 'express'
const router = express.Router();

//middlewares
router.use(middleware.redirectToLoginIfNotAUser)
router.use(middleware.updateOfferDiscountInCart)
router.use(middleware.updateCouponDiscountInCheckout)
router.use(middleware.checkForProductStockBeforeCheckout)

//routes
router.get('/' , checkout.getCheckoutPage)
router.post('/' , checkout.postPlaceOrderInCheckout)
router.post('/apply-coupon' , checkout.applyCoupon)
router.post('/order-success' , checkout.orderSuccess)

router.post('/create-razorpay-order' , checkout.createRazorPayOrder)
router.post('/verify-payment' , checkout.verifyPayment)

router.post('/wallet' , checkout.postWalletPayment)

export default router
