import Order from "../../models/orders.models.js";
import Product from "../../models/product.models.js";
import Cart from "../../models/cart.models.js";
import User from "../../models/users.models.js";
import Address from "../../models/address.models.js";
import Coupon from "../../models/couponSchema.models.js";
import Offer from "../../models/offers.models.js";
import Wallet from "../../models/wallets.models.js";
import crypto from "crypto";
import Razorpay from "razorpay";



// this is the function for showing the checkout page
const getCheckoutPage = async function (req, res) {
    try {
        const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
        const user = await User.findById(req.session.user.id).populate('addresses');
        const offers = await Offer.find({isBlocked:false})

        
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
        res.status(200).json({
            orderId: newOrder._id,
            paymentMethod,
            totalAmount: updatedTotalAmount
        })
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

const createRazorPayOrder = async (req, res) => {
    try {
        const { totalAmount } = req.body;
        console.debug('Received amount:', totalAmount);

        // Create order on Razorpay
        const razorpay = new Razorpay({
            key_id: process.env.RAZOR_KEY_ID,
            key_secret: process.env.RAZOR_SECRET_ID,
        });
        console.debug('Razorpay instance created');

        const options = {
            amount: totalAmount * 100, // Amount in smallest currency unit (e.g., paise)
            currency: "INR",
            receipt: `receipt_order_${Date.now()}`,
        };
        console.debug('Order options:', options);

        const order = await razorpay.orders.create(options);
        console.debug('Order created:', order);

        if (!order) {
            console.error('Order creation failed');
            return res.status(500).json({ success: false, message: 'Error creating Razorpay order. Please try again later.' });
        }

        res.status(200).json({ success: true, orderId: order.id, amount: order.amount, currency: order.currency });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ success: false, message: 'An error occurred while creating the Razorpay order.' });
    }
}

 // Start of Selection
const verifyPayment = async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature, selectedAddress } = req.body;
        console.debug('Received payment details:', { razorpay_payment_id, razorpay_order_id, razorpay_signature });

        
        const hmac = crypto.createHmac('sha256', process.env.RAZOR_SECRET_ID);

        hmac.update(`${razorpay_order_id}|${razorpay_payment_id}`);
        const generatedSignature = hmac.digest('hex');
        console.debug('Generated signature:', generatedSignature);

        if (generatedSignature === razorpay_signature) {
            console.debug('Payment verified successfully');

            // Create new order logic here
            const userId = req.session.user.id;
            console.debug('User ID:', userId);

            const cart = await Cart.findOne({ user: userId }).populate('items.product');
            console.debug('Cart details:', cart);

            if (!cart || cart.items.length === 0) {
                console.warn('Cart is empty');
                return res.status(400).json({ message: 'Cart is empty' });
            }

            const user = await User.findById(userId);
            console.debug('User details:', user);

            const address = await Address.findById(selectedAddress); // Assuming selectedAddress is stored in cart
            console.debug('Address details:', address);

            const newOrder = new Order({
                user: userId,
                items: cart.items.map(item => ({
                    product: item.product._id,
                    quantity: item.quantity,
                    price: item.product.price,
                    paymentMethod: 'razorpay'
                })),
                discount: cart.discount,
                subtotal: cart.subtotal,
                totalAmount: cart.total, // Use the cart's total amount
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
                paymentMethod: 'razorpay',
                couponCode: cart.couponCode, // Assuming couponCode is stored in cart
                status: 'pending'
            });

            await newOrder.save();
            console.debug('New order created:', newOrder);

            // Update stock for each product
            for (const item of cart.items) {
                const product = await Product.findById(item.product._id);
                console.debug('Product before stock update:', product);
                product.stock -= item.quantity;
                await product.save();
                console.debug('Product after stock update:', product);
            }

            // Delete the cart
            await Cart.findOneAndDelete({ user: userId });
            console.debug('Cart deleted for user:', userId);

            res.status(200).json({ success: true, message: 'Payment verified and order created successfully.', orderId: newOrder._id });
            
        } else {
            console.warn('Payment verification failed');
            res.status(400).json({ success: false, message: 'Payment verification failed. Please contact support.' });
        }
    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ success: false, message: 'An error occurred while verifying the payment.' });
    }
    
}


const postWalletPayment = async (req, res) => {
    try {
        const { selectedAddress, couponCode, totalAmount } = req.body;
        console.debug("req.body is ", req.body);

        const userId = req.session.user.id;

        // Fetch the user's cart
        const cart = await Cart.findOne({ user: userId });
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        // Fetch the selected address
        const address = await Address.findById(selectedAddress);
        if (!address) {
            return res.status(400).json({ message: 'Invalid address' });
        }

        // Fetch the user
        const user = await User.findById(userId);
        console.debug("cart is ", cart);

        
        
        // Create new order
        const newOrder = new Order({
            user: userId,
            items: cart.items.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.price,
                paymentMethod: 'wallet'
            })),
            discount: cart.discount,
            subtotal: cart.subtotal,
            totalAmount: totalAmount,
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
            paymentMethod: 'wallet',
            couponCode: couponCode || null,
            status: 'pending'
        });

        await newOrder.save();
        
        
        // Check if user has enough balance in wallet
        if (user.walletBalance < totalAmount) {
            return res.status(400).json({ message: 'Insufficient wallet balance' });
        }

        // Deduct the total amount from user's wallet balance
        user.walletBalance -= totalAmount;
        await user.save();

        // Update wallet transaction
        const wallet = await Wallet.findById(user.wallet);
        wallet.transactions.push({
            amount: -totalAmount,
            description: `Order payment for order ID: ${newOrder._id}`
        });
        await wallet.save();

        // Update stock for each product
        for (const item of cart.items) {
            const product = await Product.findById(item.product._id);
            console.debug('Product before stock update:', product);
            product.stock -= item.quantity;
            await product.save();
            console.debug('Product after stock update:', product);
        }

        // Delete the cart
        await Cart.findOneAndDelete({ user: userId });
        console.debug('Cart deleted for user:', userId);

        res.status(200).json({ orderId: newOrder._id, paymentMethod: 'wallet', totalAmount: newOrder.totalAmount });
    } catch (error) {
        console.error('Error processing wallet payment:', error);
        res.status(500).json({ success: false, message: 'An error occurred while processing the wallet payment.' });
    }
}


const orderSuccess = async (req, res) => {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    res.render('user/order-successfull', { order });
}





//here we are exporting all the function related to checkout page
export default {
        getCheckoutPage,
        postPlaceOrderInCheckout,
        applyCoupon,
        createRazorPayOrder,
        verifyPayment,
        orderSuccess,
        postWalletPayment
    }