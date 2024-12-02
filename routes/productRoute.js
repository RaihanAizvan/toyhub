import express from 'express';
import * as productController from '../controllers/userController.js';



const router = express.Router();

// Route to get a single product by ID
router.get('/:id', productController.getSingleProduct);


router.get('/categories', productController.getCategoryList);

router.post('/:id/review', productController.submitReview);




export default router;
