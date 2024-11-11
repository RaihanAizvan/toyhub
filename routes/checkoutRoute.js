import * as checkout from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js";
import express from 'express'
const router = express.Router();

//middlewares
router.use(middleware.redirectToLoginIfNotAUser)

//routes
router.get('/' , middleware.checkForProductStockBeforeCheckout, checkout.getCheckoutPage)
router.post('/' , checkout.postPlaceOrderInCheckout)

export default router
