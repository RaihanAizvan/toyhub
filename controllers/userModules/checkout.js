import Order from "../../models/orders.models.js";
import Cart from "../../models/cart.models.js";
import User from "../../models/users.models.js";
import Address from "../../models/address.models.js";
import Coupon from "../../models/couponSchema.models.js";
import Offer from "../../models/offers.models.js";
import {
    CheckoutError,
    applyCouponToCart,
    buildOrder,
    clearPurchasedCart,
    debitWallet,
    findOrderByCheckoutKey,
    loadPricedCart,
    receiptForCheckoutKey,
    recordPurchaseOnUser,
    releaseCoupon,
    releaseStock,
    removeCouponFromCart,
    reserveStock,
    spendCouponForOrder,
} from "../../utils/checkout.js";
import {
    createGatewayOrder,
    fetchGatewayPayment,
    isValidSignature,
    paymentMatches,
    toPaise,
} from "../../utils/razorpay.js";
import { creditWallet } from "../../utils/wallet.js";
import { isObjectId } from "../../utils/ownership.js";

// Retry and success pages are order reads like any other, so they only ever
// resolve orders of the session user.
const findOwnOrder = (userId, orderId) => {
    if (!userId || !isObjectId(orderId)) {
        return null;
    }
    return Order.findOne({ _id: orderId, user: userId });
};

const requireUserId = (req, res) => {
    const userId = req.session?.user?.id;
    if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return null;
    }
    return String(userId);
};

// A problem the shopper can act on keeps its own status and message. Anything
// else is a bug, and a bug is never dressed up as a stock message.
const sendCheckoutError = (res, error) => {
    if (error instanceof CheckoutError) {
        return res.status(error.status).json({
            success: false,
            message: error.message,
            ...error.details,
        });
    }

    console.error('Checkout failed:', error);
    return res.status(500).json({
        success: false,
        message: 'The checkout could not be completed. Please try again.',
    });
};

const requireOwnAddress = async (userId, addressId) => {
    const address = isObjectId(addressId)
        ? await Address.findOne({ _id: addressId, user: userId })
        : null;

    if (!address) {
        throw new CheckoutError(400, 'Invalid address');
    }
    return address;
};

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
//
// Everything that decides the order comes from the database: the cart of the
// account, the prices of the products, the promotions that apply and the
// address that belongs to the account. The request only says which attempt
// this is.
const postPlaceOrderInCheckout = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { selectedAddress, paymentMethod, checkoutKey, paymentFailed, totalAmount } = req.body;

    // A wallet order is only written by the wallet handler, which spends the
    // money in the same breath. Answering here would write an order that is
    // never charged.
    if (paymentMethod === 'wallet') {
        return res.status(400).json({
            success: false,
            message: 'A wallet order has to be paid from the wallet.',
        });
    }

    // Anything that is not a card is cash on delivery, which costs nothing up
    // front and so cannot be turned into a payment by naming another method.
    const method = paymentMethod === 'razorpay' ? 'razorpay' : 'cod';

    let reserved = null;

    try {
        const user = await User.findById(userId);
        if (!user) {
            throw new CheckoutError(401, 'Unauthorized');
        }

        // A retry of the same attempt answers with the order it already made.
        const existing = await findOrderByCheckoutKey(userId, checkoutKey);
        if (existing) {
            // The card was declined, so nothing was charged and nothing ships.
            // The stock that was held for that attempt goes back on the shelf
            // and the cart is left exactly as it was.
            if (paymentFailed) {
                if (!existing.paid && existing.paymentMethod === 'razorpay') {
                    await releaseStock(existing.items);
                    await releaseCoupon({ orderId: existing._id });
                    await Order.deleteOne({ _id: existing._id });
                }
                return res.status(200).json({
                    success: true,
                    message: 'The payment was not completed. Nothing was charged.',
                });
            }

            return res.status(200).json({
                orderId: existing._id,
                paymentMethod: existing.paymentMethod,
                totalAmount: Number(existing.totalAmount),
                repeated: true,
            });
        }

        const address = await requireOwnAddress(userId, selectedAddress);
        const { cart, lines } = await loadPricedCart(userId, { expectedTotal: totalAmount });

        reserved = await reserveStock(lines);

        const order = new Order(buildOrder({
            user,
            cart,
            lines,
            address,
            paymentMethod: method,
            // Cash on delivery and an abandoned card are not paid.
            paid: false,
            checkoutKey,
        }));

        try {
            await order.save();
        } catch (error) {
            // A duplicate key means a parallel request won the race with the
            // same attempt, so the order exists after all.
            if (error?.code === 11000) {
                await releaseStock(reserved);
                reserved = null;
                const winner = await findOrderByCheckoutKey(userId, checkoutKey);
                if (winner) {
                    return res.status(200).json({
                        orderId: winner._id,
                        paymentMethod: winner.paymentMethod,
                        totalAmount: Number(winner.totalAmount),
                        repeated: true,
                    });
                }
            }
            throw error;
        }

        await spendCouponForOrder({ cart, order, userId });

        // The cart only goes once the order is on disk.
        await clearPurchasedCart(userId);
        await recordPurchaseOnUser(user, lines);

        return res.status(200).json({
            orderId: order._id,
            paymentMethod: order.paymentMethod,
            totalAmount: Number(order.totalAmount),
        });
    } catch (error) {
        if (reserved) {
            await releaseStock(reserved);
        }
        return sendCheckoutError(res, error);
    }
};

// A coupon is matched against the shop and applied to the cart that was priced
// from the products. The amount the request carried is not read, so a coupon
// cannot be turned into a discount on an invented total.
const applyCoupon = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    try {
        const { coupon, discountAmount, totalAmount } = await applyCouponToCart(userId, req.body?.couponCode);

        return res.status(200).json({
            success: true,
            coupon,
            discountAmount,
            totalAmount,
        });
    } catch (error) {
        return sendCheckoutError(res, error);
    }
};

// Taking a coupon off is the same operation as putting one on, run backwards,
// so the page is left with a total that can be paid rather than one the
// browser worked out for itself.
const removeCoupon = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    try {
        const { discountAmount, totalAmount } = await removeCouponFromCart(userId);

        return res.status(200).json({
            success: true,
            discountAmount,
            totalAmount,
        });
    } catch (error) {
        return sendCheckoutError(res, error);
    }
};

// The amount is never taken from the request: the cart is priced again, an
// unpaid order is written for that exact amount, and only then is a gateway
// order created for it. The gateway id is stored on the order, which is what
// ties a later payment signature to this order and to no other.
const createRazorPayOrder = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { selectedAddress, checkoutKey, totalAmount } = req.body;
    let reserved = null;

    try {
        const user = await User.findById(userId);
        if (!user) {
            throw new CheckoutError(401, 'Unauthorized');
        }

        const existing = await findOrderByCheckoutKey(userId, checkoutKey);
        if (existing?.razorpayOrderId) {
            return res.status(200).json({
                success: true,
                orderId: existing.razorpayOrderId,
                amount: toPaise(existing.totalAmount),
                currency: 'INR',
                repeated: true,
            });
        }

        const address = await requireOwnAddress(userId, selectedAddress);
        const { cart, lines, totalAmount: serverTotal } = await loadPricedCart(userId, { expectedTotal: totalAmount });

        reserved = await reserveStock(lines);

        const order = new Order(buildOrder({
            user,
            cart,
            lines,
            address,
            paymentMethod: 'razorpay',
            paid: false,
            checkoutKey,
        }));

        try {
            await order.save();
        } catch (error) {
            if (error?.code === 11000) {
                await releaseStock(reserved);
                reserved = null;
                const winner = await findOrderByCheckoutKey(userId, checkoutKey);
                if (winner?.razorpayOrderId) {
                    return res.status(200).json({
                        success: true,
                        orderId: winner.razorpayOrderId,
                        amount: toPaise(winner.totalAmount),
                        currency: 'INR',
                        repeated: true,
                    });
                }
            }
            throw error;
        }

        await spendCouponForOrder({ cart, order, userId });

        try {
            const gatewayOrder = await createGatewayOrder({
                amount: toPaise(serverTotal),
                receipt: receiptForCheckoutKey(checkoutKey || order._id),
            });

            order.razorpayOrderId = gatewayOrder.id;
            order.razorpayAmount = gatewayOrder.amount;
            await order.save();
        } catch (error) {
            // The stock was only held for a payment that will never happen, and
            // the coupon with it, so both go back.
            await releaseStock(reserved);
            reserved = null;
            await releaseCoupon({ orderId: order._id });
            await Order.deleteOne({ _id: order._id });
            throw new CheckoutError(502, 'The payment gateway could not be reached. Please try again.');
        }

        // The cart stays where it is until the payment lands, so a card that is
        // declined, or a checkout that is simply abandoned, costs the shopper
        // nothing.
        return res.status(200).json({
            success: true,
            orderId: order.razorpayOrderId,
            amount: toPaise(order.totalAmount),
            currency: 'INR',
        });
    } catch (error) {
        if (reserved) {
            await releaseStock(reserved);
        }
        return sendCheckoutError(res, error);
    }
};

// A signature says the request was not altered on the way here. It does not say
// the payment happened, so the gateway is asked what happened to it, and the
// answer has to be that it settled, for this order, for this amount, in this
// currency. A payment the gateway does not know is not a payment.
const confirmPaymentWithGateway = async ({ order, paymentId }) => {
    let payment;

    try {
        payment = await fetchGatewayPayment(paymentId);
    } catch (error) {
        console.error('Could not read the payment from the gateway:', error);
        return {
            ok: false,
            status: 502,
            message: 'The payment could not be confirmed. Please try again.',
        };
    }

    const matches = paymentMatches(payment, {
        orderId: order.razorpayOrderId,
        amount: order.razorpayAmount,
        currency: 'INR',
    });

    if (!matches.ok) {
        console.warn('The gateway payment did not match the order:', matches);
        return {
            ok: false,
            status: 400,
            message: 'Payment verification failed. Please contact support.',
        };
    }

    return { ok: true, payment };
};

// The signature is only trusted once it is shown to belong to a gateway order
// this account created, for the amount this order was written for. The stock
// for the attempt was already taken when the gateway order was made, so nothing
// is taken again here.
const verifyPayment = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!isValidSignature({
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        signature: razorpay_signature,
    })) {
        return res.status(400).json({
            success: false,
            message: 'Payment verification failed. Please contact support.',
        });
    }

    try {
        const order = await Order.findOne({
            user: userId,
            razorpayOrderId: String(razorpay_order_id),
        });

        // A signature for a gateway order this account never created is not a
        // payment for one of its orders.
        if (!order) {
            return res.status(400).json({
                success: false,
                message: 'Payment verification failed. Please contact support.',
            });
        }

        if (order.paid) {
            return res.status(200).json({
                success: true,
                orderId: order._id,
                repeated: true,
            });
        }

        if (order.status === 'Cancelled' || order.status === 'stock-unavailable') {
            return res.status(409).json({
                success: false,
                message: 'This order can no longer be paid. Please contact support for a refund.',
            });
        }

        // The gateway order was created for the amount on the order, so a total
        // that no longer matches means this payment is not for this order.
        if (order.razorpayAmount !== toPaise(order.totalAmount)) {
            return res.status(409).json({
                success: false,
                message: 'The order total changed. Please start the payment again.',
            });
        }

        const confirmed = await confirmPaymentWithGateway({
            order,
            paymentId: razorpay_payment_id,
        });

        if (!confirmed.ok) {
            return res.status(confirmed.status).json({
                success: false,
                message: confirmed.message,
            });
        }

        order.razorpayPaymentId = String(razorpay_payment_id);
        order.paid = true;
        await order.save();

        const user = await User.findById(userId);
        await clearPurchasedCart(userId);
        await recordPurchaseOnUser(user, order.items);

        return res.status(200).json({
            success: true,
            orderId: order._id,
        });
    } catch (error) {
        return sendCheckoutError(res, error);
    }
};

// A wallet is only spent when the balance is still there, and the stock for the
// order is given back if anything after that does not work out.
const postWalletPayment = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { selectedAddress, checkoutKey, totalAmount } = req.body;
    let reserved = null;
    let debited = 0;
    let order = null;

    try {
        const user = await User.findById(userId);
        if (!user) {
            throw new CheckoutError(401, 'Unauthorized');
        }

        const existing = await findOrderByCheckoutKey(userId, checkoutKey);
        if (existing) {
            return res.status(200).json({
                orderId: existing._id,
                paymentMethod: existing.paymentMethod,
                totalAmount: Number(existing.totalAmount),
                repeated: true,
            });
        }

        const address = await requireOwnAddress(userId, selectedAddress);
        const { cart, lines, totalAmount: serverTotal } = await loadPricedCart(userId, { expectedTotal: totalAmount });

        reserved = await reserveStock(lines);

        // The order is written first, because the debit is keyed by the order
        // and a request that repeats this one finds the order it already made
        // and spends nothing.
        order = new Order(buildOrder({
            user,
            cart,
            lines,
            address,
            paymentMethod: 'wallet',
            paid: false,
            checkoutKey,
        }));

        await spendCouponForOrder({ cart, order, userId });

        try {
            await order.save();
        } catch (error) {
            if (error?.code === 11000) {
                const winner = await findOrderByCheckoutKey(userId, checkoutKey);
                if (winner) {
                    // Another request with the same key already paid for this
                    // order, so this one only gives the stock back.
                    await releaseStock(reserved);
                    reserved = null;
                    return res.status(200).json({
                        orderId: winner._id,
                        paymentMethod: winner.paymentMethod,
                        totalAmount: Number(winner.totalAmount),
                        repeated: true,
                    });
                }
            }
            throw error;
        }

        try {
            await debitWallet({
                user,
                amount: serverTotal,
                orderId: order._id,
                description: 'Order payment',
            });
            debited = serverTotal;
        } catch (error) {
            // Nothing shipped and nothing was charged, so the order written for
            // this attempt is taken back along with the stock and the coupon.
            await releaseCoupon({ orderId: order._id });
            await Order.deleteOne({ _id: order._id });
            await releaseStock(reserved);
            reserved = null;
            throw error;
        }

        order.paid = true;
        await order.save();

        await clearPurchasedCart(userId);
        await recordPurchaseOnUser(user, lines);

        return res.status(200).json({
            orderId: order._id,
            paymentMethod: 'wallet',
            totalAmount: Number(order.totalAmount),
        });
    } catch (error) {
        if (reserved) {
            await releaseStock(reserved);
        }
        if (debited) {
            // Nothing shipped, so the money goes back to the wallet. The key is
            // the order, so this gives the money back once and never twice.
            await creditWallet({
                userId,
                amount: debited,
                reason: 'refund',
                idempotencyKey: `refund:order:${order?._id}`,
                reference: { order: order?._id },
                description: 'Refund for an order that could not be placed',
            });
        }
        return sendCheckoutError(res, error);
    }
};

const orderSuccess = async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await findOwnOrder(req.session?.user?.id, orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        res.render('user/order-successfull', { order });
    } catch (error) {
        console.error('Error rendering order success page:', error);
        res.status(500).json({ success: false, message: 'An error occurred.' });
    }
}

// A retry asks the gateway for a new order on the amount this order was
// written for, and stores the new gateway id on the order. Storing it is what
// makes a later signature payable to this order: a signature for the id that
// was replaced no longer matches anything.
const retryPayment = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { orderId } = req.body;

    try {
        const order = await findOwnOrder(userId, orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.paid) {
            return res.status(409).json({
                success: false,
                message: 'This order is already paid.',
            });
        }

        if (order.status === 'Cancelled' || order.status === 'stock-unavailable') {
            return res.status(409).json({
                success: false,
                message: 'This order can no longer be paid. Please contact support.',
            });
        }

        const amount = toPaise(order.totalAmount);
        let gatewayOrder;

        try {
            gatewayOrder = await createGatewayOrder({
                amount,
                receipt: receiptForCheckoutKey(`rtry_${order._id}_${Date.now()}`),
            });
        } catch (error) {
            console.error('Error creating Razorpay order:', error);
            return res.status(502).json({
                success: false,
                message: 'The payment gateway could not be reached. Please try again.',
            });
        }

        order.razorpayOrderId = gatewayOrder.id;
        order.razorpayAmount = gatewayOrder.amount;
        await order.save();

        return res.status(200).json({
            success: true,
            message: 'New Razorpay order created successfully',
            razorpay_order_id: gatewayOrder.id,
            amount: gatewayOrder.amount,
            currency: gatewayOrder.currency,
        });
    } catch (error) {
        return sendCheckoutError(res, error);
    }
};

// The payment is only accepted for the gateway order this order is currently
// waiting on, so a signature taken from another payment cannot pay this order.
const verifyRetryPayment = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!isValidSignature({
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        signature: razorpay_signature,
    })) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature' });
    }

    try {
        const order = await findOwnOrder(userId, orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (order.razorpayOrderId !== String(razorpay_order_id)) {
            return res.status(400).json({
                success: false,
                message: 'This payment is not for this order. Please start the payment again.',
            });
        }

        if (order.paid) {
            return res.status(200).json({ success: true, repeated: true });
        }

        if (order.status === 'Cancelled' || order.status === 'stock-unavailable') {
            return res.status(409).json({
                success: false,
                message: 'This order can no longer be paid. Please contact support for a refund.',
            });
        }

        if (order.razorpayAmount !== toPaise(order.totalAmount)) {
            return res.status(409).json({
                success: false,
                message: 'The order total changed. Please start the payment again.',
            });
        }

        const confirmed = await confirmPaymentWithGateway({
            order,
            paymentId: razorpay_payment_id,
        });

        if (!confirmed.ok) {
            return res.status(confirmed.status).json({
                success: false,
                message: confirmed.message,
            });
        }

        order.razorpayPaymentId = String(razorpay_payment_id);
        order.paid = true;
        await order.save();

        const user = await User.findById(userId);
        await clearPurchasedCart(userId);
        await recordPurchaseOnUser(user, order.items);

        return res.status(200).json({ success: true });
    } catch (error) {
        return sendCheckoutError(res, error);
    }
};

//here we are exporting all the function related to checkout page
export default {
        getCheckoutPage,
        postPlaceOrderInCheckout,
        applyCoupon,
        removeCoupon,
        createRazorPayOrder,
        verifyPayment,
        retryPayment,
        orderSuccess,
        postWalletPayment,
        verifyRetryPayment
    }