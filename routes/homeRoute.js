import * as home from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();

router.get('/product', middleware.checkBlockStatus, home.getSingleProduct);

router.get('/categories/all', home.viewAllCategories);

export default router