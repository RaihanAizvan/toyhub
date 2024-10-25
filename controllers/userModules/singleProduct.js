import Product from "../../models/product.models.js"
import Category from '../../models/categories.model.js'
export const getSingleProduct = async (req, res) => {
    try {
        // Get the product ID from the URL params
        const productId = req.params.id;

        // Fetch the product from the database
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).redirect('/');
        }

        // Render the product page with dynamic data
        res.render('user/singleProduct', {
            title: product.name,
            product,
        });
    } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).send("Server error");
    }
};

export const filterProducts = async (req, res) => {
        try {
            let query = {};
    
            // Sort criteria for name
            if (req.body.sort === 'atoz') {
                query.sort = { name: 1 }; // A to Z sorting
            } else if (req.body.sort === 'ztoa') {
                query.sort = { name: -1 }; // Z to A sorting
            } else if (req.body.sort === 'lowToHigh') {
                query.sort = { price: 1 }; // Price: Low to High
            } else if (req.body.sort === 'highToLow') {
                query.sort = { price: -1 }; // Price: High to Low
            }

            
    
            const filteredProducts = await Product.find().sort(query.sort);
    
            res.status(200).json({ data: filteredProducts, page: req.body.page });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Failed to filter products' });
        }
    }

    async function searchResults(req, res) {
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
      
            // Calculate total pages
            const totalPages = Math.ceil(totalCount / limit);
      
            // Check if the requested page is within the valid range
            if (page > totalPages) {
                return res.status(400).json({ message: 'Invalid page number' });
            }
      
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
                pages: totalPages,
            });
        } catch (error) {
            console.error("Search Error:", error);
            res.status(500).json({ message: 'Error fetching search results' });
        }
      }

export default {getSingleProduct, filterProducts, searchResults}