import Order from "../../models/orders.models.js";

// GET route to render the admin orders page
const getAdminOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Fetch orders with pagination
        const orders = await Order.find().populate('user').skip(skip).limit(limit).exec();
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
    try {
        const { status } = req.body;
        const orderId = req.params.id;

        // Update the order's status in the database
        await Order.findByIdAndUpdate(orderId, { status: status });

        res.json({ success: true });
    } catch (error) {
        console.error("Error updating order status:", error);
        res.json({ success: false });
    }
};


const getAdminOrderDetails = async(req,res) =>{
    try {
        const orderId = req.params.orderId;
    
        // Find order by ID and populate user and product details
        const order = await Order.findById(orderId)
          .populate('user', 'name email phone_number joined_date') // Populate user info (name and email)
          .populate('items.product', 'name price images') // Populate product info (name and price)
        console.log(order);
        if (!order) {
          return res.status(404).send('Order not found');
        }
    
        // Render the order detail page with the fetched order data
        res.render('admin/order-details', { order });
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