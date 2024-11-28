import Order from "../../models/orders.models.js"
import Users from "../../models/users.models.js"
import Product from "../../models/product.models.js"
import Wishlist from "../../models/wishlist.models.js"
import Wallet from "../../models/wallets.models.js"
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export async function getProfileEdit(req, res) {
    let theName = req.session.user?.name
    let user = await Users.findOne({ name: theName })
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
                    stockStatus,
                    statusColor,
                    // Use the first image if available
                    firstImage: productImages.length > 0 ? productImages[0] : null,
                    // formattedPrice: `$${item.product.price.toFixed(2)}`,
                };
            });

            return {
                ...order._doc,
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
        const order = await Order.findById(orderId).populate('items.product'); // Populate the product details

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
        const order = await Order.findById(orderId).populate('user');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Ensure the order is still cancellable
        if (order.status === 'Cancelled' || order.status === 'Delivered') {
            return res.status(400).json({ message: 'Order cannot be canceled at this stage' });
        }

        // Update order status to 'Cancelled'
        order.status = 'Cancelled';
        await order.save();

        // Increase the stock for each product in the order
        for (let item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: item.quantity } }, // Increase the stock by the item quantity
                { new: true }
            );
        }

        // If the order type is Razorpay or Wallet, return the amount to the user's wallet
        if (order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet') {
            const user = order.user;
            user.walletBalance += order.totalAmount;
            user.wallet.balance += order.totalAmount;
            await user.save();

            const wallet = await Wallet.findById(user.wallet);
            wallet.transactions.push({
                amount: order.totalAmount,
                description: `Refund for cancelled order ID: ${orderId}`
            });
            await wallet.save();
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
    const orderId = req.params.id;
    const order = await Order.findById(orderId);
    try {
        res.render('user/cancel-reason', { title: 'Cancel reason', order })
    } catch (error) {
        console.log(error);
    }
}

// deletion of product for individual item

export const postCancelReason = async (req, res) => {
    const { orderId } = req.params;
    const { itemId } = req.body;

    try {
        // Find the order by ID
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        // Find the item to cancel
        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);

        if (itemIndex === -1) {
            return res.status(404).send('Item not found in order');
        }

        // Update item status to 'Cancelled' or remove it from the items array
        order.items[itemIndex].status = 'Cancelled'; // or you could remove it if that's your design

        // Optionally, update the total amount, if necessary
        order.totalAmount -= order.items[itemIndex].price * order.items[itemIndex].quantity;

        // Save the updated order
        await order.save();

        // Redirect back to the order details page with a success message
        res.redirect(`/account/orders/${orderId}?message=Item cancelled successfully`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
}

export const postItemCancel = async (req, res) => {
    const { orderId } = req.params;
    const { itemId } = req.body;

    try {
        // Find the order by ID
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        // Find the item to cancel
        const itemIndex = order.items.findIndex(item => item._id.toString() === itemId);

        if (itemIndex === -1) {
            return res.status(404).send('Item not found in order');
        }

        // Update item status to 'Cancelled'
        order.items[itemIndex].status = 'Cancelled';

        // Optionally, update the total amount, if necessary
        order.totalAmount -= order.items[itemIndex].price * order.items[itemIndex].quantity;

        // Check if all items in the order are cancelled
        const allCancelled = order.items.every(item => item.status === 'Cancelled');

        // If all items are cancelled, mark the order as cancelled
        if (allCancelled) {
            order.status = 'Cancelled'; //this is used to mark the order as cancelled in the database
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

export const getWallet = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).redirect('/login'); // Redirect to login if user is not authenticated
    }

    try {
        const user = await Users.findById(req.session.user.id).populate('wallet');
        if (!user || !user.wallet) {
            console.log("no wallet")
            const newWallet = new Wallet({ user:user.id, balance: 0, transactions: [] });
            await newWallet.save();
            user.wallet = newWallet._id;
            await user.save();
            return res.status(200).render('user/wallet', { title: 'Wallet', user, transactions: [], currentPage: 1, totalPages: 1, req });
        }

        // Sort transactions by date in descending order (most recent first)
        user.wallet.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

        const transactionsPerPage = 10;
        const currentPage = parseInt(req.query.page) || 1;
        const startIndex = (currentPage - 1) * transactionsPerPage;
        const endIndex = startIndex + transactionsPerPage;
        const paginatedTransactions = user.wallet.transactions.slice(startIndex, endIndex);
        const totalPages = Math.ceil(user.wallet.transactions.length / transactionsPerPage);

        res.render('user/wallet', { 
            title: 'Wallet', 
            user, 
            transactions: paginatedTransactions, 
            currentPage, 
            totalPages,
            req
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        res.status(500).send('Internal server error');
    }
};

export const postAddMoney = async (req, res) => {
    let { amount } = req.body;
    amount = Number(amount);
    if (!amount || amount <= 0) {
        return res.status(400).json({ message: 'Invalid amount' });
    }

    try {
        const user = await Users.findById(req.session.user.id).populate('wallet');

        if (!user || !user.wallet) {
            return res.status(404).json({ message: 'Wallet not found' });
        }

        const currentDateTime = new Date();
        user.wallet.balance += amount;
        user.walletBalance += amount;
        user.wallet.transactions.push({
            date: currentDateTime,
            description: 'Added money to wallet',
            amount: amount
        });

        // Sort transactions by date and time in descending order
        user.wallet.transactions.sort((a, b) => b.date - a.date);

        await user.wallet.save();
        await user.save();

        res.status(200).json({ message: 'Money added successfully', balance: user.wallet.balance });
    } catch (error) {
        console.error('Error adding money to wallet:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
}


export const postDownloadInvoice = async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await Order.findById(orderId).populate('user').populate('items.product');
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

        const products = order.items.map((item, index) => ({
            sno: index + 1,
            productName: item.product.name,
            quantity: item.quantity,
            discount: (item.product.price - item.product.priceAfterDiscount).toFixed(2) || "-",
            price: item.product.price.toFixed(2),
            total: (item.quantity * item.product.priceAfterDiscount).toFixed(2)
        }));

        const tableColumn = [
            { header: '#', dataKey: 'sno' },
            { header: 'Product Name', dataKey: 'productName' },
            { header: 'Quantity', dataKey: 'quantity' },
            { header: 'Discount', dataKey: 'discount' },
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
        doc.text(`Offer Discount: - ${order.offerDiscount.toFixed(2)}`, 14, totalY + 14);
        doc.text(`Coupon Discount: - ${order.discount.toFixed(2)}`, 14, totalY + 20);
        doc.setFontSize(14);
        doc.text(`Total Amount: ${order.totalAmount.toFixed(2)}`, 14, totalY + 26);

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
    postAddMoney,
    postDownloadInvoice
}
