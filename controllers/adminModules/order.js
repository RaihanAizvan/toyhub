import Order, { ORDER_STATUSES, normaliseOrderStatus } from "../../models/orders.models.js";
import { ADMIN_TRANSITIONS, adminTransition, cancelOrder } from "../../utils/order-transitions.js";

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
    const next = req.body.status;

    // The status of an order is one of a list, checked here rather than trusted
    // from a request. It used to be written straight onto the order, so the
    // shape of the database was whatever string a form happened to post.
    if (!ORDER_STATUSES.includes(next)) {
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

        const allowed = adminTransition(order, next);
        if (!allowed.allowed) {
            return res.status(allowed.reason === 'order_is_closed' ? 409 : 400).json({
                success: false,
                status: normaliseOrderStatus(order.status),
                message: allowed.reason === 'order_is_closed'
                    ? `This order is already ${allowed.status} and stays that way.`
                    : `An order that is ${allowed.status} cannot become ${next}.`,
            });
        }

        // Cancelling is not a label: it returns the money and puts the stock
        // back, whichever side of the shop it is asked from. The route is what
        // makes this an administrator's request.
        if (next === 'cancelled') {
            const outcome = await cancelOrder({ orderId, actor: 'admin', reason: req.body.reason ?? null });

            if (!outcome.ok) {
                return res.status(outcome.code).json({ success: false, message: outcome.message });
            }

            return res.json({
                success: true,
                status: 'cancelled',
                refund: outcome.refund,
                // Where the money went is part of the answer: an
                // administrator has just changed something the shopper is
                // waiting to hear about.
                message: outcome.moneyMessage ?? (outcome.refund.refunded
                    ? 'Order cancelled and the payment returned.'
                    : 'Order cancelled.'),
            });
        }

        order.status = next;
        await order.save();

        res.json({ success: true, status: next });
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
        res.render('admin/order-details', {
            order: view,
            ORDER_STATUSES,
            // The form offers only the moves this order can actually make, so
            // a closed order cannot be re-opened by choosing a word from a list.
            nextStatuses: ADMIN_TRANSITIONS[view.status] ?? [],
            title: 'Order Details',
        });
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