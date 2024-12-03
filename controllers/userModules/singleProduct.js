import Product from "../../models/product.models.js"
import Category from '../../models/categories.model.js'
import User from '../../models/users.models.js'
import Offer from '../../models/offers.models.js'
import mongoose from 'mongoose'
import Rating from '../../models/ratings.models.js'



export const getSingleProduct = async (req, res) => {
    try {
        // Get the product ID from the URL params
        const productId = req.params.id;

        // Validate if productId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(404).redirect('/');
        }

        // Fetch the product from the database
        const product = await Product.findById(productId)
            .populate('category')
            .populate({
                path: 'ratings',
                populate: {
                    path: 'userId',
                    select: 'name'
                }
            });
        
        // Check if product exists
        if (!product) {
            return res.status(404).redirect('/');
        }

        const reviews = await Rating.find({ productId: productId }).populate('userId')
        

        const offers = await Offer.find({isBlocked:false})

        const productFromSameCategory = await Product.find({category:product.category}).limit(8);
        // First try to find related products based on name/description match
        let relatedProducts = await Product.find({
            $and: [
                { _id: { $ne: productId } },
                {
                    $or: [
                        { name: { $regex: new RegExp(product.name.split(' ').join('|'), 'i') } },
                        { description1: { $regex: new RegExp(product.name.split(' ').join('|'), 'i') } }
                    ]
                }
            ]
        }).limit(7);

        // If no related products found, get products from same category
        if (relatedProducts.length === 0) {
            relatedProducts = await Product.find({
                _id: { $ne: productId },
                category: product.category
            }).limit(7);
        }

        // If still no products, get random products
        if (relatedProducts.length === 0) {
            relatedProducts = await Product.aggregate([
                { $match: { _id: { $ne: product._id } } },
                { $sample: { size: 7 } }
            ]);
        }
        
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
            offers,
            productFromSameCategory,
            relatedProducts,
            reviews
        });
    } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).send("Server error");
    }
};

export const searchAndFilterProducts = async (req, res) => {
    try {
        const { q, sort, category, page = 1, minPrice, maxPrice } = req.query;
        const limit = 10;
        const skip = (parseInt(page) - 1) * limit;

        // Build query object for search and filtering
        let query = { isBlocked: false };
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

        // Price range handling
        if (minPrice || maxPrice) {
            query.priceAfterDiscount = {};
            if (minPrice) query.priceAfterDiscount.$gte = parseFloat(minPrice);
            if (maxPrice) query.priceAfterDiscount.$lte = parseFloat(maxPrice);
        }

        // Sort handling
        switch (sort) {
            case 'lowToHigh':
                sortOptions.priceAfterDiscount = 1;
                break;
            case 'highToLow':
                sortOptions.priceAfterDiscount = -1;
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
        const categories = await Category.find({isActive:true});

        // Fetch filtered and sorted products
        const products = await Product.find(query)
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
            minPrice,
            maxPrice,
            noResults: products.length === 0,
            totalResults: totalCount,
            name:req.session.user?.name
        });
        
    } catch (error) {
        console.error('Search and filter error:', error);
        res.status(500).send('Server error');
    }
};

async function submitReview(req, res) {
    try {
        //check for user
        if (!req.session.user) {
            return res.status(401).json({ message: 'You must be logged in to submit a review' });
        }
      const { rating, title, comment } = req.body;
      const productId = req.params.id;
      const userId = req.session.user.id;

      // Validate userId
      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' });
      }
  
      // Create new rating document
      const newRating = new Rating({
        userId,
        productId,
        rating,
        title,
        comment,
        date: new Date(),
        isVerifiedPurchase: false // Could check order history to verify
      });
  
      // Save the rating
      await newRating.save();
  
      // Add rating reference to user
      await User.findByIdAndUpdate(userId, {
        $push: { ratings: newRating._id }
      });
  
      // Update product with new rating
      const product = await Product.findById(productId);
      product.ratings.push(newRating._id);
      
      // Recalculate average rating
      const allRatings = await Rating.find({ productId });
      const ratingSum = allRatings.reduce((sum, r) => sum + r.rating, 0);
      product.averageRating = ratingSum / allRatings.length;
      product.ratingCount = allRatings.length;
      
      // Update rating stats
      product.ratingStats = allRatings.reduce((stats, r) => {
        stats[r.rating] = (stats[r.rating] || 0) + 1;
        return stats;
      }, {});
  
      await product.save();
  
      res.status(200).json({ message: 'Review submitted successfully' });
  
    } catch (error) {
      console.error('Error submitting review:', error);
      res.status(500).json({ message: 'Failed to submit review' });
    }
  }

export const searchProducts = async (req, res) => {
    try {
        const { q } = req.query;
        
        // Return empty array if query is too short
        if (!q || q.length < 2) {
            console.log("No query")
            return res.json([]);
        }

        // Find products matching name or description with case-insensitive regex
        // Limit to 5 suggestions for better UX
        const products = await Product.find(
            {
                $or: [
                    { name: { $regex: q, $options: 'i' } },
                    { description1: { $regex: q, $options: 'i' } },
                    { description2: { $regex: q, $options: 'i' } }
                ],
                isBlocked: false
            },
            { name: 1, _id: 1 } // Include _id field
        );



        if (!products) {
            console.log("No products found");
            return res.json([]);
        }

        res.json(products);

    } catch (error) {
        console.error('Error fetching search suggestions:', error);
        res.status(500).json({ error: error.message });
    }
}

export default {getSingleProduct, searchAndFilterProducts, submitReview, searchProducts}