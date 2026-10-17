import express from 'express';
import * as productController from '../controllers/userController.js';



const router = express.Router();

// A static address must be decided before the parameterized one, or a request
// for /product/categories is read as a product whose id is "categories".
router.get('/categories', productController.getCategoryList);


// Route to get a single product by ID
router.get('/:id', productController.getSingleProduct);

router.post('/:id/review', productController.submitReview);




export default router;
