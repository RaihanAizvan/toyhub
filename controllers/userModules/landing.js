import Product from '../../models/product.models.js'
import User from '../../models/users.models.js';
import users from '../adminModules/users.js';
import Category from '../../models/categories.model.js';


async function getLandingPage(req, res) {
    try {
        const flashMessage = req.session.flashMessage || null;
        if (req.session.flashMessage) {
            delete req.session.flashMessage;
          }
        
        // Fetch the latest active products for "Popular Products"
        const popularProducts = await Product.find({ isBlocked: false })
            .sort({ createdAt: -1 }) 
            
        // Fetch the best-selling active products sorted by "sold" field
        const bestSellerProducts = await Product.find({ isBlocked: false })
            .sort({ sold: -1 })  // Sorting by sold units, descending (most sold)
            .limit(10);  // Limit to 10 products (adjustable)

        // Fetch all categories (no need for isBlocked filter here unless categories have a similar field)
        const categories = await Category.find({}).sort({ createdAt: -1 }).limit(5)

        // Check if the user is authenticated
        const user = req.user || req.session.user;  // Assuming you're using session or authentication middleware

        if (user) {
            res.render('user/home', {
                title: "ToyHub",
                auth: true,
                name: user.name,
                popularProducts,
                bestSellerProducts,
                categories,
                flashMessage: flashMessage ? { message: flashMessage, type: type } : null
            });
            
        } else {
            res.render('user/home', {
                title: "ToyHub",
                auth: false,
                name: 'Login',  // Show "Login" if not authenticated
                popularProducts,
                bestSellerProducts,
                categories,
                flashMessage: flashMessage ? { message: flashMessage, type: type } : null
            });
        }
    } catch (error) {
        console.error('Error fetching products and categories:', error);
        res.status(500).send('Internal Server Error');
    }
}

export default { getLandingPage }