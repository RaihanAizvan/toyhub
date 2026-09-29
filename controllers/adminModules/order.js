import Order, { ORDER_STATUSES, normaliseOrderStatus } from "../../models/orders.models.js";

// GET route to render the admin orders page
const getAdminOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Fetch orders with pagination
        const orders = (await Order.find()
            .populate('user')
            .sort({ orderDate: -1 })
            .skip(skip)
            .limit(limit)
            .exec()).map((order) => ({
                ...order.toObject(),
                status: normaliseOrderStatus(order.status),
            }));
        const totalOrders = await Order.countDocuments();

        res.render('admin/orders', {
            orders,
            currentPage: page,
            totalPages: Math.ceil(totalOrders / limit),
            startIndex: skip + 1 // Start index for the new page
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
};


const postUpdateOrderStatus = async (req, res) => {
    const orderId = req.params.id;

    // The status of an order is one of a list, checked here rather than trusted
    // from a request. It used to be written straight onto the order, so the
    // shape of the database was whatever string a form happened to post.
    if (!ORDER_STATUSES.includes(req.body.status)) {
        return res.status(400).json({
            success: false,
            message: `An order can be ${ORDER_STATUSES.join(', ')}.`,
        });
    }

    try {
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        order.status = req.body.status;
        await order.save();

        res.json({ success: true });
    } catch (error) {
        console.error("Error updating order status:", error);
        res.status(500).json({ success: false, message: 'Could not update the order' });
    }
};


const getAdminOrderDetails = async(req,res) =>{
    try {
        const orderId = req.params.orderId;
    
        // Find order by ID and populate user and product details
        const order = await Order.findById(orderId)
          .populate('user', 'name email phone_number joined_date') // Populate user info (name and email)
          .populate('items.product', 'name price images') // Populate product info (name and price)
        
        if (!order) {
          return res.status(404).send('Order not found');
        }
        console.log(order);
    
        // The page asks "is this shipped", "is this cancelled", so it is handed
        // the word this application uses rather than whatever an old order says.
        const view = {
            ...order.toObject(),
            status: normaliseOrderStatus(order.status),
            items: order.items.map((item) => ({
                ...item.toObject(),
                status: normaliseOrderStatus(item.status),
            })),
        };

        // Render the order detail page with the fetched order data
        res.render('admin/order-details', { order: view, ORDER_STATUSES, title: 'Order Details' });
      } catch (err) {
        console.error(err);
        res.status(500).send('Server error');
      }
}


export default{
    getAdminOrders,
    postUpdateOrderStatus,
    getAdminOrderDetails
}