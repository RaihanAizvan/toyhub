import * as checkout from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js";
import express from 'express'
const router = express.Router();

//middlewares
router.use(middleware.redirectToLoginIfNotAUser)

//routes
router.get('/' , checkout.getCheckoutPage)

export default router
