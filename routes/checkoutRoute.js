import * as checkout from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js";
import express from 'express'
const router = express.Router();

//middlewares
router.use(middleware.redirectToLoginIfNotAUser)
router.use(middleware.updateOfferDiscountInCart)
router.use(middleware.updateCouponDiscountInCheckout)
//routes
router.get('/' , middleware.checkForProductStockBeforeCheckout, checkout.getCheckoutPage)
router.post('/' , checkout.postPlaceOrderInCheckout)
router.post('/apply-coupon' , checkout.applyCoupon)

router.post('/create-razorpay-order' , checkout.createRazorPayOrder)
router.post('/verify-payment' , checkout.verifyPayment)

export default router
