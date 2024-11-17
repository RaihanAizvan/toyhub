import Product from "../../models/product.models.js"
import Category from '../../models/categories.model.js'
import User from '../../models/users.models.js'
import Offer from '../../models/offers.models.js'

export const getSingleProduct = async (req, res) => {
    try {
        // Get the product ID from the URL params
        const productId = req.params.id;

        // Fetch the product from the database
        const product = await Product.findById(productId).populate('category');
        const offers = await Offer.find({isBlocked:false})
        

        if (!product) {
            return res.status(404).redirect('/');
        }

        let wishlist = [];
        if (req.session.user) {
            const userWithWishlist = await User.findById(req.session.user.id);
            wishlist = userWithWishlist ? userWithWishlist.wishlist : [];
        }

        // Render the product page with dynamic data
        res.render('user/singleProduct', {
            title: product.name,
            product,
            wishlist,
            offers
        });
    } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).send("Server error");
    }
};

export const searchAndFilterProducts = async (req, res) => {
    try {
        const { q, sort, category, page = 1 } = req.query;
        const limit = 10;
        const skip = (parseInt(page) - 1) * limit;

        // Build query object for search and filtering
        let query = {};
        let sortOptions = {};

        // Search query handling
        if (q) {
            query.$or = [
                { name: { $regex: q, $options: 'i' } },
                { description1: { $regex: q, $options: 'i' } },
                { description2: { $regex: q, $options: 'i' } }
            ];
        }

        // Category filter handling
        if (category) {
            const categoryArray = Array.isArray(category) ? category : category.split(',');
            query.category = { $in: categoryArray };
        }

        // Sort handling
        switch (sort) {
            case 'lowToHigh':
                sortOptions.price = 1;
                break;
            case 'highToLow':
                sortOptions.price = -1;
                break;
            case 'atoz':
                sortOptions.name = 1;
                break;
            case 'ztoa':
                sortOptions.name = -1;
                break;
            default:
                // Default sorting (can be modified based on requirements)
                sortOptions = { createdAt: -1 };
        }

        // Fetch total count for pagination
        const totalCount = await Product.countDocuments(query);
        const totalPages = Math.ceil(totalCount / limit);

        // Validate page number
        const validatedPage = Math.min(Math.max(1, parseInt(page)), totalPages || 1);

        if (validatedPage !== parseInt(page)) {
            return res.redirect(`/search/results?${new URLSearchParams({
                ...req.query,
                page: validatedPage
            }).toString()}`);
        }

        // Fetch categories for filter sidebar
        const categories = await Category.find({});

        // Fetch filtered and sorted products
        const products = await Product.find({ ...query, isBlocked: false })
            .collation({ locale: 'en', strength: 2 })
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .lean(); // Use lean() for better performance

        // Handle single exact match
        if (products.length === 1 && 
            q && 
            products[0].name.toLowerCase() === q.toLowerCase()) {
            return res.redirect(`/product/${products[0]._id}`);
        }

        // Prepare pagination data
        const pagination = {
            currentPage: validatedPage,
            totalPages,
            hasNextPage: validatedPage < totalPages,
            hasPrevPage: validatedPage > 1,
            nextPage: validatedPage + 1,
            prevPage: validatedPage - 1
        };
        
        

        // Render results
        res.render('user/searchResults', {
            title: q ? `Search Results - ${q}` : 'All Products',
            results: products,
            query: q || '',
            categories,
            pagination,
            
            page,
            pages: totalPages,
            sort,
            category,
            q,
            noResults: products.length === 0,
            totalResults: totalCount,
            name:req.session.user?.name
        });
        
    } catch (error) {
        console.error('Search and filter error:', error);
        res.status(500).send('Server error');
    }
};


export default {getSingleProduct, searchAndFilterProducts}