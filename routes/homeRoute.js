import * as home from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import express from "express";
const router = express.Router();


router.use(middleware.checkBlockStatus)

router.get('/product', home.getSingleProduct);

router.get('/categories/all', home.viewAllCategories);

router.get('/search/results', home.searchResults);

router.post('/api/filter-products', home.filterProducts);



export default router