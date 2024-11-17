import Order from "../../models/orders.models.js";
import Product from "../../models/product.models.js";
import Cart from "../../models/cart.models.js";
import User from "../../models/users.models.js";
import Address from "../../models/address.models.js";
import Coupon from "../../models/couponSchema.models.js";
import Offer from "../../models/offers.models.js";
import crypto from "crypto";
import Razorpay from "razorpay";
import cart from "./cart.js";
const razorpay = new Razorpay({
  key_id: process.env.RAZOR_KEY_ID,
  key_secret: process.env.RAZOR_SECRET_ID,
});

// this is the function for showing the checkout page
const getCheckoutPage = async function (req, res) {
    try {
        const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
        const user = await User.findById(req.session.user.id).populate('addresses');
        const offers = await Offer.find({isBlocked:false})

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
            name:req.session.user?.name,
            offers
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Internal Server Error' })
    }
}

// this is a handler function for sending post request to /checkout

const postPlaceOrderInCheckout = async (req, res) => {
    try {
        
        const userId = req.session.user.id;
        const { selectedAddress, paymentMethod, couponCode } = req.body;
        console.log("req.body", req.body); 
        if(paymentMethod === "razorpay"){
            return res.redirect('/checkout/create-razorpay-order')
        }
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const address = await Address.findById(selectedAddress);
        if (!address) {
            return res.status(400).json({ message: 'Invalid address' });
        }

        const user = await User.findById(userId);

        // Ensure the totalAmount reflects the updated cart total after applying the coupon
        const updatedTotalAmount = cart.total;
        

        // Create new order
        const newOrder = new Order({
            user: userId,
            items: cart.items.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.product.price,
                paymentMethod: paymentMethod
            })),
            discount: cart.discount,
            subtotal: cart.subtotal,
            totalAmount: updatedTotalAmount, // Use the updated total amount
            offerDiscount: cart.offerDiscount,
            cutoffAmount: Math.round(cart.cutoffAmount),
            couponDiscount: cart.couponDiscount,
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
            couponCode,
            status: 'pending'
        });

        await newOrder.save();
        await Cart.findOneAndDelete({ user: userId });

        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            product.stock -= item.quantity;
            await product.save();
        }

        res.clearCookie('cart');
        res.clearCookie('couponApplied');
        res.status(200).render('user/order-successfull', { order: newOrder });
    } catch (error) {
        console.error("Error in postPlaceOrderInCheckout:", error);
        res.status(500).render('user/order-failed', { message: 'Internal Server Error' });
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

        // Check if the coupon is active and has not been used before
        if (coupon.isBlocked || coupon.usageLimit <= 0) {
            return res.status(400).json({ success: false, message: 'Coupon is not active or has been used too many times.' });
        }

        // Check minimum purchase requirement
        if (totalAmount < coupon.minPurchase) {
            return res.status(400).json({
                success: false,
                message: `Coupon requires a minimum purchase of $${coupon.minPurchase.toFixed(2)}.`,
            });
        }

        // Calculate the discount
        let discountAmount = 0;
        if (coupon.discountType === 'percentage') {
            discountAmount = (totalAmount * coupon.discount) / 100;
            discountAmount = Math.min(discountAmount, coupon.maxDiscount || discountAmount); // Apply max discount if set
        } else if (coupon.discountType === 'fixed') {
            discountAmount = coupon.discount;
        }

        // Update the cart with the coupon discount
        const cart = await Cart.findOne({ user: req.session.user.id });
        if (cart) {
            cart.couponDiscount = discountAmount;
            cart.total = cart.subtotal - cart.discount - cart.offerDiscount - cart.couponDiscount + cart.cutoffAmount;

            // Update cutoffAmount based on the new total
            const cutoffAmount = cart.subtotal * 0.20;
            if (cart.total < cutoffAmount) {
                cart.cutoffAmount = cutoffAmount - cart.total;
                cart.total = cutoffAmount.toFixed(2);
            } else {
                cart.cutoffAmount = 0;
            }

            await cart.save();
        }

        // Calculate the new total after discount
        const discountedTotal = cart ? cart.total : totalAmount - discountAmount;

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
        applyCoupon,
    }