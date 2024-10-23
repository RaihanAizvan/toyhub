import Order from "../../models/orders.models.js";

// GET route to render the admin orders page
const getAdminOrders = async (req, res) => {
    try {
        // Fetch all orders
        const orders = await Order.find().populate('user').exec();
        res.render('admin/orders', { orders });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
};


const postUpdateOrderStatus = async (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;

    try {
        // Find the order by ID
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).send('Order not found');
        }

        // Update the order status
        order.status = status;

        // Save the updated order
        await order.save();

        // Redirect back to the admin orders page with a success message
        res.redirect('/admin/orders?message=Order status updated successfully');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
};


export default{
    getAdminOrders,
    postUpdateOrderStatus
}