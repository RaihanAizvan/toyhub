import Product from "../../models/product.models.js"
import Category from '../../models/categories.model.js'
import User from '../../models/users.models.js'
import { offersForProduct } from "../../utils/offer-rules.js";
import mongoose from 'mongoose'
import Rating from '../../models/ratings.models.js'
import Order from '../../models/orders.models.js'
import {
  cleanReviewText,
  isEligibleOrderStatus,
  isReviewableProductId,
  parseRating,
  REVIEW_COMMENT_MAX,
  REVIEW_TITLE_MAX,
  summariseRatings,
} from "../../utils/reviews.js";



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
        

        // Only the live offers that actually name this product, decided by the
        // same function that prices the cart.
        const offers = await offersForProduct(product);

        const productFromSameCategory = await Product.find({category:product.category})
            .populate('category')
            .limit(8);
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

// Someone is an eligible reviewer when they have an order for the product that
// has actually been sent. Reads the order's own state through the normaliser,
// so an order written before the status list existed still counts.
const hasOrderedTheProduct = async (userId, productId) => {
  const match = await Order.findOne({
    user: userId,
    items: { $elemMatch: { product: productId } },
  }).lean();

  if (!match) {
    return false;
  }
  if (isEligibleOrderStatus(match.status)) {
    return true;
  }
  // A line can be cancelled on its own while the rest of the order goes out, so
  // one bad line does not cancel the whole order's claim.
  return (match.items ?? []).some(
    (item) =>
      String(item.product) === String(productId) && isEligibleOrderStatus(item.status),
  );
};

// Recomputes everything a product page shows about its reviews and writes it in
// one update: the average, the count, the five-way split, and the list of review
// ids the page reads its "top three" from. They used to be read back out of every
// review and written with a document save, which loses one writer's numbers to
// another's, and the review id was pushed onto the product separately, so the
// list and the totals could disagree.
const syncProductRatingSummary = async (productId) => {
  const ratings = await Rating.find({ productId })
    .select('_id rating status')
    .sort({ date: -1 })
    .lean();
  const summary = summariseRatings(ratings);

  await Product.updateOne(
    { _id: productId },
    { $set: { ...summary, ratings: ratings.map((rating) => rating._id) } },
  );
  return summary;
};

export const submitReview = async (req, res) => {
    try {
        const userId = req.session?.user?.id;
        if (!userId) {
            return res.status(401).json({ message: 'You must be logged in to submit a review' });
        }

        const productId = req.params.id;
        if (!isReviewableProductId(productId)) {
            return res.status(404).json({ message: 'That product does not exist' });
        }

        const product = await Product.findById(productId).select('_id').lean();
        if (!product) {
            // It used to reach the aggregate step and fail on a missing document,
            // which answered a deleted product with a 500.
            return res.status(404).json({ message: 'That product does not exist' });
        }

        const rating = parseRating(req.body?.rating);
        if (rating === null) {
            return res.status(400).json({ message: 'Choose a rating from 1 to 5' });
        }

        const title = cleanReviewText(req.body?.title, REVIEW_TITLE_MAX);
        const comment = cleanReviewText(req.body?.comment, REVIEW_COMMENT_MAX);

        // The flag used to be written as a literal `false` with a note that
        // checking the order history would be nicer, so anyone with a session
        // could review anything and be counted as a buyer.
        if (!(await hasOrderedTheProduct(userId, product._id))) {
            return res.status(403).json({
                message: 'You can only review a product you have received',
            });
        }

        const fields = {
            rating,
            title,
            comment,
            date: new Date(),
            isVerifiedPurchase: true,
        };

        // One review per product per person: a second attempt edits the first
        // rather than adding to the count.
        const existing = await Rating.findOne({ productId, userId }).select('_id').lean();

        let review;
        let created = false;
        if (existing) {
            review = await Rating.findByIdAndUpdate(existing._id, { $set: fields }, { new: true });
        } else {
            review = await Rating.create({ ...fields, productId, userId });
            created = true;
        }

        await syncProductRatingSummary(product._id);

        return res.status(created ? 201 : 200).json({
            message: created ? 'Review submitted successfully' : 'Review updated successfully',
            reviewId: review._id.toString(),
        });
    } catch (error) {
        // Two people can pass the check above at the same moment and the second
        // create loses on the unique index. That is the same person being told
        // their review is already there, not a failure.
        if (error?.code === 11000) {
            return res.status(409).json({ message: 'You have already reviewed this product' });
        }
        console.error('Error submitting review:', error);
        return res.status(500).json({ message: 'Failed to submit review' });
    }
};

// A suggestion is a short label, so the search is short too. Without a bound a
// caller could hand this a megabyte of text and ask the database to match it.
const MAX_SEARCH_LENGTH = 60;
const MAX_SEARCH_RESULTS = 8;

// The text is matched literally. It used to be dropped into a `$regex` as typed,
// which meant a shopper could send `.*` and match everything, or `(a+)+` and
// occupy a database worker for a very long time.
const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const searchProducts = async (req, res) => {
    try {
        const raw = typeof req.query.q === 'string' ? req.query.q : '';
        const q = raw.trim().slice(0, MAX_SEARCH_LENGTH);

        // Too short to be worth asking about, or nothing left after trimming.
        if (q.length < 2) {
            return res.json([]);
        }

        const pattern = new RegExp(escapeForRegex(q), 'i');

        const products = await Product.find(
            {
                $or: [
                    { name: pattern },
                    { description1: pattern },
                    { description2: pattern },
                ],
                isBlocked: false,
            },
            // Only what a suggestion row needs, and `_id` so the browser can link
            // to the canonical product route instead of searching for the name
            // again.
            { name: 1, _id: 1 },
        )
            // The comment here used to promise five suggestions; without a limit
            // the query answered with every product in the shop.
            .limit(MAX_SEARCH_RESULTS)
            .lean();

        return res.json(products);
    } catch (error) {
        // The reason is not sent on: it names collection shapes and query
        // structure to whoever asked.
        console.error('Error fetching search suggestions:', error);
        return res.status(500).json({ error: 'Search is unavailable right now' });
    }
}

export default {getSingleProduct, searchAndFilterProducts, submitReview, searchProducts}