import * as cart from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.use(middleware.checkBlockStatus)

router.get('/', cart.getCart);

router.post('/update-quantity', cart.updateQuantity)

router.post('/addProduct',cart.postAddProductToCart)

router.post('/remove-item', cart.postRemoveItemFromCartHandler)




export default router