import Cart from "../../models/cart.models.js"
import User from "../../models/users.models.js"

// this is the function for showing the checkout page
const getCheckoutPage = async function(req,res){
    try {
        const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
        const user = await User.findById(req.session.user.id).populate('addresses');
        console.log(cart);
        console.log(user);

        res.render('user/checkout', {
            cart,  // Cart with items
            user,   // User with addresses
        });
    } catch (error) {
        
    }
}

// this is a handler function for sending post request to /checkout

//here we are exporting all the function related to checkout page

export default {
    getCheckoutPage
}