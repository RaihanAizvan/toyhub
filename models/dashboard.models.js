import mongoose from 'mongoose';

const dashboardMetricsSchema = new mongoose.Schema({
    banner: { type: mongoose.Schema.Types.ObjectId, ref: 'Banner' },
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' },
    adminID: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
    discountID: { type: mongoose.Schema.Types.ObjectId, ref: 'Discount' },
    totalOrders: { type: Number, required: true },
    activeOrders: { type: Number, required: true },
    completedOrders: { type: Number, required: true },
    salesGraphs: [{
        date: { type: Date },
        amount: { type: Number }
    }],
    bestSellers: [{
        productId: { type: mongoose.Schema.Types.ObjectId },
        productName: { type: String },
        totalSales: { type: Number }
    }],
    recentOrders: [{
        orderId: { type: mongoose.Schema.Types.ObjectId },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser' },
        date: { type: Date },
        status: { type: String },
        amount: { type: Number }
    }]
});

const DashboardMetrics = mongoose.model('DashboardMetrics', dashboardMetricsSchema);

export default DashboardMetrics;
