import Order from "../../models/orders.models.js"
import Users from "../../models/users.models.js"
import Product from "../../models/product.models.js"

export async function getProfileEdit(req, res) {
    let theName = req.session.user?.name
    let user = await Users.findOne({ name: theName })
    res.status(200).render('user/profile-edit', {
        user,
        title: 'Profile Edit',
        name: user.name
    })
}

export async function postUpdateName(req, res) {
    let userId = req.session.user?.id
    const { name } = req.body
    if (!name) {
        return res.status(400).render('user/profile-edit', {
            error: "Name is required",
            user: req.session.user, // Send the current user session back
            classes: 'profile-information',
            title: 'Profile Edit'
        });
    }

    try {
        // Update user name
        let updatedUser = await Users.findByIdAndUpdate(userId, { name: name }, { new: true });

        // Update session data with the new name
        req.session.user.name = updatedUser.name;

        // Redirect back to the profile or re-render the page with the updated data
        return res.redirect('/account');
    } catch (error) {
        console.error(error);
        return res.status(500).render('user/profile-edit', {
            error: "An error occurred while updating the name.",
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
export async function getOrderHistory(req, res) {
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
            console.log(firstImage ? firstImage : "No image available");
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
        console.log(name);
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
        console.log(`Attempting to cancel order with ID: ${orderId}`); // Debugging log

        // Find the order by ID
        const order = await Order.findById(orderId);

        if (!order) {
            console.log(`Order with ID ${orderId} not found`); // Debugging log
            return res.status(404).json({ message: 'Order not found' });
        }

        // Ensure the order is still cancellable
        if (order.status === 'Cancelled' || order.status === 'Delivered') {
            console.log(`Order with ID ${orderId} cannot be canceled at this stage`); // Debugging log
            return res.status(400).json({ message: 'Order cannot be canceled at this stage' });
        }

        // Update order status to 'Cancelled'
        order.status = 'Cancelled';
        await order.save();
        console.log(`Order with ID ${orderId} status updated to 'Cancelled'`); // Debugging log

        // Increase the stock for each product in the order
        for (let item of order.items) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: item.quantity } }, // Increase the stock by the item quantity
                { new: true }
            );
            console.log(`Stock for product ${item.product} increased by ${item.quantity}`); // Debugging log
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
    console.log(1);
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
            order.status = 'Cancelled';
        }

        // Save the updated order
        await order.save();

        // Redirect back to the order details page with a success message
        res.redirect(`/account/orders/${orderId}?message=Item cancelled successfully`);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
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
    postItemCancel
}
