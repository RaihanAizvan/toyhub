import Order from "../../models/orders.models.js";
import Product from "../../models/product.models.js";
import Cart from "../../models/cart.models.js";
import User from "../../models/users.models.js";
import Address from "../../models/address.models.js";
import Coupon from "../../models/couponSchema.models.js";
// this is the function for showing the checkout page
const getCheckoutPage = async function (req, res) {
    try {
        const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
        const user = await User.findById(req.session.user.id).populate('addresses');

        if (!user.addresses || user.addresses.length === 0) {
            return res.status(400).json({ message: 'No address found. Please add an address before proceeding to checkout.' });
        }
        const coupons = await Coupon.find({
            isBlocked: false,
            usageLimit: { $gt: 0 },
            
        });

        res.render('user/checkout', {
            cart,  // Cart with items
            user,   // User with addresses
            coupons,
            title: "Checkout",
            name:req.session.user?.name
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Internal Server Error' })
    }
}

// this is a handler function for sending post request to /checkout
export const postPlaceOrderInCheckout = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { selectedAddress, paymentMethod } = req.body;

        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const address = await Address.findById(selectedAddress);
        if (!address) {
            return res.status(400).json({ message: 'Invalid address' });
        }

        const totalAmount = cart.items.reduce((total, item) => total + (item.quantity * item.product.price), 0);

        const user = await User.findById(userId);

        const newOrder = new Order({
            user: userId,
            items: cart.items.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.product.price
            })),
            totalAmount,
            discount: cart.discount || 0,
            address: {
                user: {
                    name: user.name,
                    email: user.email,
                    joined_date: user.joined_date,
                    phone_number: user.phone_number
                },
                name: address.name,
                street: address.street,
                city: address.city,
                state: address.state,
                zip: address.zip,
                phone: address.phone
            },
            paymentMethod,
            status: 'pending'
        });

        console.log("Removing items from browser session storage for user:", userId);
        res.cookie('cart', '', { expires: new Date(0) });
        res.clearCookie('cart');
        res.clearCookie('couponApplied');

        console.log("Saving order in the database:", newOrder);
        await newOrder.save();

        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            product.stock -= item.quantity;
            await product.save();
        }

        await Cart.findOneAndDelete({ user: userId });

        res.status(200).render('user/order-successfull',{order:newOrder});
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

const applyCoupon = async (req, res) => {
    const { couponCode, totalAmount } = req.body;

    try {
        // Find the coupon in the database
        const coupon = await Coupon.findOne({ couponCode });
        if (!coupon) {
            return res.status(404).json({ success: false, message: 'Coupon code not found.' });
        }

        

        // Check minimum purchase requirement
        if (totalAmount < coupon.minPurchase) {
            return res.status(400).json({
                success: false,
                message: `Coupon requires a minimum purchase of $${coupon.minPurchase.toFixed(2)}.`,
            });
        }

        // Calculate the discount
        let discountAmount;
        if (coupon.discountType === 'percentage') {
            discountAmount = (totalAmount * coupon.discount) / 100;
            discountAmount = Math.min(discountAmount, coupon.maxDiscount); // Apply max discount if set
        } else {
            discountAmount = coupon.discount;
        }

        // Calculate the new total after discount
        const discountedTotal = totalAmount - discountAmount;

        // Update the coupon usage count
        coupon.usageLimit -= 1;
        await coupon.save();

        // Return success response with the discount details
        res.status(200).json({
            success: true,
            discountAmount,
            discountedTotal,
            coupon,
        });
    } catch (error) {
        console.error('Error applying coupon:', error);
        res.status(500).json({ success: false, message: 'An error occurred while applying the coupon.' });
    }
}

//here we are exporting all the function related to checkout page
export default {
        getCheckoutPage,
        postPlaceOrderInCheckout,
        applyCoupon
    }