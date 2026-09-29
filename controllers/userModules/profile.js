import Order, { normaliseOrderStatus } from "../../models/orders.models.js"
import Users from "../../models/users.models.js"
import Product from "../../models/product.models.js"
import Wishlist from "../../models/wishlist.models.js"
import Rating from "../../models/ratings.models.js"
import WalletTopup, {
    isTopUpAmountAllowed,
    normaliseTopUpAmount,
    topUpExpiry,
} from "../../models/walletTopups.models.js";
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { isObjectId } from "../../utils/ownership.js";
import { createGatewayOrder, fetchGatewayPayment, isValidSignature, paymentMatches, toPaise } from "../../utils/razorpay.js";
import { WalletError, creditWallet, getOrCreateWallet, listLedger, reconcileWallet } from "../../utils/wallet.js";

const requireUserId = (req, res) => {
    const userId = req.session?.user?.id;
    if (!userId) {
        res.status(401).json({ success: false, message: 'Unauthorized' });
        return null;
    }
    return String(userId);
};

// A wallet problem the shopper can act on keeps its own message. Anything else
// is a bug, and a bug never answers as a balance.
const sendWalletError = (res, error) => {
    if (error instanceof WalletError) {
        return res.status(error.status).json({ success: false, message: error.message });
    }

    console.error('Wallet operation failed:', error);
    return res.status(500).json({ success: false, message: 'The wallet could not be updated. Please try again.' });
};

// Every order endpoint answers from this one lookup, so an order id that
// belongs to somebody else answers exactly like an id that does not exist.
const findOwnOrder = (req, orderId) => {
    const userId = req.session?.user?.id;
    const filter = userId && isObjectId(orderId)
        ? { _id: orderId, user: userId }
        : { _id: null };
    return Order.findOne(filter);
};

export async function getProfileEdit(req, res) {
    let theName = req.session.user?.name
    // The session id is the identity, the name in the session is only a label.
    let user = await Users.findById(req.session.user?.id)
    res.status(200).render('user/profile-edit', {
        user,
        title: 'Profile Edit',
        name: theName //thename is the name of the user which is stored in the session
    })
}

export async function postUpdateName(req, res) { //this function is used to update the name of the user
    let userId = req.session.user?.id
    const { name } = req.body
    if (!name) {
        return res.status(400).render('user/profile-edit', {//if the name is not provided then it will render the profile edit page with the error message
            error: "Name is required",
            user: req.session.user, // Send the current user session back
            classes: 'profile-information', //this is the class of the profile edit page which is used to style the page dyhnamically
            title: 'Profile Edit'
        });
    }


    try {
        // Update user name
        let updatedUser = await Users.findByIdAndUpdate(userId, { name: name }, { new: true }); //this is used to update the name of the user in the database

        // Update session data with the new name
        req.session.user.name = updatedUser.name;


        // Redirect back to the profile or re-render the page with the updated data
        return res.redirect('/account');
    } catch (error) {
        console.error(error);
        return res.status(500).render('user/profile-edit', {
            error: "An error occurred while updating the name." ,
            user: req.session.user,
            classes: 'profile-information',
            title: 'Profile Edit'
        });
    }
}

export async function postUpdatePhone(req, res) {
    let userId = req.session.user?.id;
    const { phone_number } = req.body;

    if (!phone_number) {
        return res.status(400).render('user/profile-edit', {
            error: "Phone number is required",
            user: req.session.user,
            classes: 'profile-information',
            title: 'Profile Edit'
        });
    }

    try {
        // Update user phone number
        let updatedUser = await Users.findByIdAndUpdate(userId, { phone_number: phone_number }, { new: true });

        // Update session data with the new phone number
        req.session.user.phone_number = updatedUser.phone_number;

        // Redirect back to the profile or re-render the page with the updated data
        return res.redirect('/account');
    } catch (error) {
        console.error(error);
        return res.status(500).render('user/profile-edit', {
            error: "An error occurred while updating the phone number.",
            user: req.session.user,
            classes: 'profile-information',
            title: 'Profile Edit'
        });
    }
}



//function for showing order history
export async function getOrderHistory(req, res) { //this function is used to show the order history of the user
    try {
        const userId = req.session.user.id;

        // Fetch all orders for the logged-in user and sort them by recent date
        const orders = await Order.find({ user: userId }).populate('items.product').sort({ orderDate: -1 });

        // ... existing code ...
        const ordersWithDetails = orders.map(order => {
            const formattedItems = order.items.map(item => {
                // Determine product stock status and color
                let stockStatus = "In Stock";
                let statusColor = "green";

                // Check if product exists and has images
                const productImages = item.product && item.product.images ? item.product.images : [];

                return {
                    product: item.product,
                    quantity: item.quantity,
                    // The price the line was bought at, and the name it had then.
                    price: item.price,
                    name: item.name ?? item.product?.name ?? null,
                    status: normaliseOrderStatus(item.status),
                    stockStatus,
                    statusColor,
                    // Use the first image if available
                    firstImage: productImages.length > 0
                        ? productImages[0]
                        : (item.image ?? null),
                };
            });

            return {
                ...order._doc,
                status: normaliseOrderStatus(order.status),
                items: formattedItems,

            };
        });

        // Log the first image of the first product in a more understandable way
        if (ordersWithDetails.length > 0 && ordersWithDetails[0].items.length > 0) {
            const firstImage = ordersWithDetails[0].items[0].firstImage;
        }
        // ... existing code ...

        res.render('user/recent-orders', {
            orders: ordersWithDetails,
            name: req.session.user.name,
            title: "My Orders",
        });
    } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}




//oder detail

export const getOrderDetail = async (req, res) => {
    try {
        const orderId = req.params.id; // Fetch the order ID from the URL parameters
        // The buyer and the products are both references, and both pages below
        // read them by name, so both are populated here rather than from a copy
        // that was taken when the order was written.
        const order = await findOwnOrder(req, orderId)
            .populate('user')
            .populate('items.product');

        if (!order) {
            return res.status(404).send('Order not found');
        }
        const name = req.session.user.name
        // Render the order details EJS page with the retrieved order
        res.render('user/order-detail', { order, name, title: 'Order Detail' });
    } catch (error) {
        console.error("Error fetching order details:", error);
        res.status(500).send('Server Error');
    }
};

export const postOrderCancel = async (req, res) => {
    try {
        const orderId = req.params.id;

        // Find the order by ID
        const order = await findOwnOrder(req, orderId).populate('user');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Ensure the order is still cancellable
        // Compared through the list, so an order written as "Cancelled" or
        // "Delivered" or "completed" is still recognised as closed.
        const status = normaliseOrderStatus(order.status);
        if (status === 'cancelled' || status === 'delivered') {
            return res.status(400).json({ message: 'Order cannot be canceled at this stage' });
        }

        order.status = 'cancelled';
        await order.save();

        // Increase the stock for each product in the order
        for (let item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: item.quantity } }, // Increase the stock by the item quantity
                { new: true }
            );
        }

        // If the order type is Razorpay or Wallet, return the amount to the
        // user's wallet. The key is the order, so asking for this refund twice
        // credits the shopper once.
        if (order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet') {
            const refund = Number(order.totalAmount) || 0;
            if (refund > 0) {
                await creditWallet({
                    userId: order.user,
                    amount: refund,
                    reason: 'refund',
                    idempotencyKey: `refund:order:${order._id}`,
                    reference: { order: order._id },
                    description: `Refund for cancelled order ID: ${orderId}`,
                });
            }
        }

        // Redirect to my orders page after cancelling
        req.session.toast = "Order Cancelled"
        res.redirect('/account/orders');
    } catch (error) {
        console.error('Error canceling order:', error); // Debugging log
        res.status(500).send('Server Error');
    }
}

export const getCancelReason = async (req, res) => {
    try {
        const orderId = req.params.id;
        const order = await findOwnOrder(req, orderId);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        res.render('user/cancel-reason', { title: 'Cancel reason', order })
    } catch (error) {
        console.log(error);
        res.status(500).send('Server Error');
    }
}

export const postItemCancel = async (req, res) => {
    const { orderId } = req.params;
    const { itemId } = req.body;

    try {
        // Find the order by ID
        const order = await findOwnOrder(req, orderId);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        // Find the item to cancel
        const itemIndex = order.items.findIndex(
            item => String(item._id) === String(itemId),
        );

        if (itemIndex === -1) {
            return res.status(404).send('Item not found in order');
        }

        order.items[itemIndex].status = 'cancelled';

        // Optionally, update the total amount, if necessary
        order.totalAmount -= order.items[itemIndex].price * order.items[itemIndex].quantity;

        // Check if all items in the order are cancelled
        const allCancelled = order.items.every(item => normaliseOrderStatus(item.status) === 'cancelled');

        // If all items are cancelled, mark the order as cancelled
        if (allCancelled) {
            order.status = 'cancelled';
        }

        // Save the updated order
        await order.save();

        // Redirect back to the order details page with a success message
        res.redirect(`/account/orders/${orderId}?message=Item cancelled successfully`);
    } catch (error) {
        console.error(error);
        res.status(500).send('server error');
    }
}

//wishlist
export const getWishlist = async (req, res) => {
    const userId = req.session.user.id; // Log the user ID

    try {
        // Populate the 'wishlist' field in the User model, which contains references to 'Product'
        const user = await Users.findById(userId).populate('wishlist');

        // Log the fetched wishlist

        res.render('user/wishlist', {
            title: 'Wishlist',
            name: req.session.user?.name,
            wishlistItems: user.wishlist || []
        });
    } catch (error) {
        console.error('Error fetching wishlist:', error);
        res.status(500).send('Internal server error');
    }
};


export const postWishlist = async (req, res) => {
    const { productId } = req.body;
    try {
        const user = await Users.findById(req.session.user.id)


        //check if the product is alreadyu in the wishlist
        if (user.wishlist && user.wishlist.includes(productId)) {
            return res.status(400).json({
                message: "product already in whishlist"
            })
        }

        // if not add the product to the wishlist

        user.wishlist.push(productId);
        await user.save();

        return res.status(200).json({ message: "product added to whishlist" })
    }
    catch (err) {
        console.log(err)
        return res.status(500).json({ message: "internal server error" })
    }
}




export const deleteWishlist = async (req, res) => {
    const { productId } = req.body;

    try {
        const user = await Users.findById(req.session.user.id);
        // Check if the product is in the wishlist
        if (!user.wishlist.includes(productId)) {
            return res.status(400).json({
                message: "Product not found in wishlist"
            });
        }

        // Remove the product from the wishlist
        user.wishlist = user.wishlist.filter(id => id.toString() !== productId);
        await user.save();

        return res.status(200).json({ message: "Product removed from wishlist" });
    } catch (error) {
        console.error('Error removing product from wishlist:', error);
        return res.status(500).json({ message: "Internal server error" });
    }
}

// The page and the money come from the same place: the balance is the wallet
// document, and the history is the ledger the balance moved through.
export const getWallet = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    try {
        const [wallet, history] = await Promise.all([
            getOrCreateWallet(userId),
            listLedger({ userId, page: req.query.page }),
        ]);

        return res.status(200).render('user/wallet', {
            title: 'Wallet',
            user: { _id: userId, name: req.session.user?.name },
            wallet,
            balance: Number(wallet.balance),
            transactions: history.entries,
            currentPage: history.currentPage,
            totalPages: history.totalPages,
            req,
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        return res.status(500).send('Internal server error');
    }
};

// A top up is written down by the shop before a payment is started, and the
// amount the browser asked for is the amount that is recorded and paid. A
// request cannot credit a balance, it can only ask for a payment.
export const postCreateTopUp = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const amount = normaliseTopUpAmount(req.body?.amount);
    if (!isTopUpAmountAllowed(amount)) {
        return res.status(400).json({
            success: false,
            message: 'Choose an amount between 10 and 100000.',
        });
    }

    try {
        const topup = await WalletTopup.create({
            user: userId,
            amount,
            currency: 'INR',
            status: 'pending',
            expiresAt: topUpExpiry(),
        });

        let gatewayOrder;
        try {
            gatewayOrder = await createGatewayOrder({
                amount: toPaise(amount),
                receipt: `topup_${topup._id}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40),
            });
        } catch (error) {
            // The top up never became payable, so it is not left behind as one.
            await WalletTopup.deleteOne({ _id: topup._id });
            throw new WalletError(502, 'The payment gateway could not be reached. Please try again.');
        }

        topup.razorpayOrderId = gatewayOrder.id;
        await topup.save();

        return res.status(200).json({
            success: true,
            topUpId: String(topup._id),
            orderId: gatewayOrder.id,
            amount: gatewayOrder.amount,
            currency: gatewayOrder.currency,
        });
    } catch (error) {
        return sendWalletError(res, error);
    }
};

// The money only reaches the wallet when the gateway itself says this payment
// settled, for this top up, for this amount, in this currency. The ledger key
// means a callback that arrives twice credits once.
export const postVerifyTopUp = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    const { topUpId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!isValidSignature({
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        signature: razorpay_signature,
    })) {
        return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    try {
        const topup = await WalletTopup.findOne({
            _id: isObjectId(topUpId) ? topUpId : null,
            user: userId,
        });

        // A payment for somebody else's top up, or for one that does not exist,
        // credits nothing.
        if (!topup) {
            return res.status(404).json({ success: false, message: 'Top up not found.' });
        }

        if (topup.status === 'credited') {
            const wallet = await getOrCreateWallet(userId);
            return res.status(200).json({
                success: true,
                balance: Number(wallet.balance),
                repeated: true,
            });
        }

        if (topup.status === 'failed' || topup.expiresAt < new Date()) {
            return res.status(410).json({
                success: false,
                message: 'This top up is no longer payable. Please start again.',
            });
        }

        if (topup.razorpayOrderId !== String(razorpay_order_id)) {
            return res.status(400).json({
                success: false,
                message: 'This payment is not for this top up.',
            });
        }

        let payment;
        try {
            payment = await fetchGatewayPayment(razorpay_payment_id);
        } catch (error) {
            console.error('Error reading the payment from the gateway:', error);
            return res.status(502).json({
                success: false,
                message: 'The payment could not be confirmed. Nothing was added.',
            });
        }

        const matches = paymentMatches(payment, {
            orderId: topup.razorpayOrderId,
            amount: toPaise(topup.amount),
            currency: topup.currency,
        });

        if (!matches.ok) {
            console.warn('Top up payment did not match:', matches);
            topup.status = 'failed';
            await topup.save();
            return res.status(400).json({
                success: false,
                message: 'That payment was not accepted. Nothing was added.',
            });
        }

        const { wallet, applied } = await creditWallet({
            userId,
            amount: Number(topup.amount),
            reason: 'topup',
            idempotencyKey: `topup:${topup._id}`,
            reference: {
                topup: topup._id,
                razorpayOrderId: topup.razorpayOrderId,
                razorpayPaymentId: String(razorpay_payment_id),
            },
            description: 'Added money to wallet',
        });

        topup.razorpayPaymentId = String(razorpay_payment_id);
        topup.status = 'credited';
        await topup.save();

        return res.status(200).json({
            success: true,
            balance: Number(wallet.balance),
            applied,
        });
    } catch (error) {
        return sendWalletError(res, error);
    }
};

// What the ledger says the balance should be, next to what is stored.
export const getWalletReconciliation = async (req, res) => {
    const userId = requireUserId(req, res);
    if (!userId) {
        return;
    }

    try {
        return res.status(200).json({ success: true, ...(await reconcileWallet(userId)) });
    } catch (error) {
        return sendWalletError(res, error);
    }
};

export const postDownloadInvoice = async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await findOwnOrder(req, orderId).populate('user').populate('items.product');
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const doc = new jsPDF();

        // Add title
        // Initialize the PDF document
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(18);
        doc.text('Invoice', 105, 20, { align: 'center' }); // Centered title

        // Add order details
        doc.setFontSize(12);
        doc.text('Order Details:', 14, 30); // Section title
        doc.setFontSize(10);
        doc.text(`Order ID: ${order._id}`, 14, 38);
        doc.text(`Order Date: ${order.orderDate.toDateString()}`, 14, 44);
        doc.text(`Customer Name: ${order.user.name}`, 14, 50);
        doc.text(`Customer Email: ${order.user.email}`, 14, 56);

        // Add table of products
        doc.setFontSize(12);
        doc.text('Product Details:', 14, 66); // Section title

        // The line as it was bought: the price stored on the order, not the
        // product's price today, and the name kept with the line so a deleted
        // product still prints.
        const products = order.items.map((item, index) => ({
            sno: index + 1,
            productName: item.name ?? item.product?.name ?? 'This product is no longer listed',
            quantity: item.quantity,
            price: item.price.toFixed(2),
            total: (item.quantity * item.price).toFixed(2)
        }));

        const tableColumn = [
            { header: '#', dataKey: 'sno' },
            { header: 'Product Name', dataKey: 'productName' },
            { header: 'Quantity', dataKey: 'quantity' },
            { header: 'Price', dataKey: 'price' },
            { header: 'Total', dataKey: 'total' }
        ];

        doc.autoTable({
            columns: tableColumn,
            body: products,
            startY: 70,
            theme: 'grid',
            columnStyles: {
                sno: { cellWidth: 10 },
                productName: { cellWidth: 50 },
                quantity: { cellWidth: 20 },
                discount: { cellWidth: 20 },
                price: { cellWidth: 20 },
                total: { cellWidth: 20 }
            },
            styles: {
                fontSize: 10
            }
        });

        // Add total amount
        const totalY = doc.lastAutoTable.finalY + 10; // Dynamic position below the table
        doc.setFontSize(12);
        doc.text('Summary:', 14, totalY);
        doc.setFontSize(10);
        doc.text(`Subtotal : ${order.subtotal.toFixed(2)}`, 14, totalY + 8);
        doc.text(`Product Discount: - ${order.discount.toFixed(2)}`, 14, totalY + 14);
        doc.text(`Offer Discount: - ${order.offerDiscount.toFixed(2)}`, 14, totalY + 20);
        doc.text(`Coupon Discount: - ${order.couponDiscount.toFixed(2)}`, 14, totalY + 26);
        doc.setFontSize(14);
        doc.text(`Total Amount: ${order.totalAmount.toFixed(2)}`, 14, totalY + 32);

        // Add footer
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.text('Thank you for your purchase!', 105, pageHeight - 10, { align: 'center' });

        // Generate PDF and send as response
        const pdfOutput = doc.output();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice_${orderId}.pdf`);
        res.send(pdfOutput);
    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}

export const getReviews = async (req, res) => {
    try {
        const userId = req.session.user.id;
        
        // Fetch reviews with populated product details
        const reviews = await Rating.find({ userId })
            .populate({
                path: 'productId',
                select: 'name images price' // Only get needed fields
            })
            .sort({ date: -1 }); // Sort by newest first

        res.render('user/reviews', {
            reviews,
            title: 'My Reviews',
            error: null
        });

    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.render('user/reviews', {
            reviews: [],
            title: 'My Reviews', 
            error: 'Failed to load reviews'
        });
    }
}

export default {
    getProfileEdit,
    postUpdateName,
    postUpdatePhone,
    getOrderHistory,
    getOrderDetail,
    postOrderCancel,
    getCancelReason,
    postItemCancel,
    getWishlist,
    postWishlist,
    deleteWishlist,
    getWallet,
    postCreateTopUp,
    postVerifyTopUp,
    getWalletReconciliation,
    postDownloadInvoice,
    getReviews
}
