import * as home from "../controllers/userController.js"
import middleware from "../middlewares/userMiddleware.js"
import Product from "../models/product.models.js";
import Category from '../models/categories.model.js'; // Import the Category model
import express from "express";
import { title } from "process";
const router = express.Router();

router.use(middleware.checkBlockStatus)

router.get('/product', home.getSingleProduct);

router.get('/categories/all', home.viewAllCategories);


router.get('/search/results', async (req, res) => {
    const query = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    try {
        // Get all matching categories if query is provided
        const categories = query.length > 0 ? await Category.find({ name: { $regex: new RegExp(query, 'i') } }) : [];
        const allCategories = await Category.find({});

        // Map category IDs if categories are found
        const categoryIds = categories.map(cat => cat._id);

        // Create filter for products based on query and category
        const filter = query.length > 0 ? {
            $or: [
                { name: { $regex: new RegExp(query, 'i') } },
                { description1: { $regex: new RegExp(query, 'i') } },
                { description2: { $regex: new RegExp(query, 'i') } },
                { category: { $in: categoryIds } }
            ]
        } : {};

        // Count total matching documents for accurate pagination
        const totalCount = await Product.countDocuments(filter);

        // Retrieve results based on query with skip and limit
        const results = await Product.find(filter).skip(skip).limit(limit);

        // If exactly one result matches, redirect to that product's page
        if (results.length === 1 && results[0].name.toLowerCase() === query.toLowerCase()) {
            return res.redirect(`/product/${results[0]._id}`);
        }

        // Render with accurate page and total page count
        res.render('user/searchResults', {
            title:`Search - ${query}`,
            results,
            query,
            categories: allCategories,
            page,
            pages: Math.ceil(totalCount / limit),
        });
    } catch (error) {
        console.error("Search Error:", error);
        res.status(500).json({ message: 'Error fetching search results' });
    }
});


export default router