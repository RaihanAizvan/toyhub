import Order from "../../models/orders.models.js"
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Utility function to get date ranges based on filter
const getDateRange = (period) => {
  const today = new Date();

  const ranges = {
    daily: {
      start: new Date(today.setHours(0, 0, 0, 0)),
      end: new Date(today.setHours(23, 59, 59, 999))
    },
    weekly: {
      start: new Date(today.setDate(today.getDate() - today.getDay())),
      end: new Date(today.setDate(today.getDate() - today.getDay() + 6))
    },
    monthly: {
      start: new Date(today.getFullYear(), today.getMonth(), 1),
      end: new Date(today.getFullYear(), today.getMonth() + 1, 0)
    },
    annual: {
      start: new Date(today.getFullYear(), 0, 1),
      end: new Date(today.getFullYear(), 11, 31)
    }
  };

  ranges.weekly.start.setHours(0, 0, 0, 0);
  ranges.weekly.end.setHours(23, 59, 59, 999);
  ranges.monthly.start.setHours(0, 0, 0, 0);
  ranges.monthly.end.setHours(23, 59, 59, 999);
  ranges.annual.start.setHours(0, 0, 0, 0);
  ranges.annual.end.setHours(23, 59, 59, 999);

  return ranges[period] || {};
};

// Utility function to format order data for export
const formatOrderData = (order) => ({
  _id: order._id,
  customerName: order.address.user.name,
  orderDate: new Date(order.orderDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }),
  address: `${order.address.street}, ${order.address.city}, ${order.address.state}, ${order.address.zip}`,
  totalAmount: order.totalAmount,
  discount: order.discount,
  offerDiscount: order.offerDiscount,
  couponDiscount: order.couponDiscount,
  cutoffAmount: order.cutoffAmount,
  subtotal: order.subtotal,
  paymentMethod: order.paymentMethod,
  status: order.status
});

export const getSalesReport = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const period = req.query.period || 'all';

    let dateFilter = {};
    if (period !== 'all') {
      const dateRange = getDateRange(period);
      dateFilter = {
        orderDate: {
          $gte: dateRange.start,
          $lte: dateRange.end
        },
        status: "Delivered"
      };
    }

    const [orderDetails, totalCount] = await Promise.all([
      Order.find(dateFilter)
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(dateFilter)
    ]);

    // Get filtered orders for each period
    const periods = ['daily', 'weekly', 'monthly', 'annual'];
    const filteredOrders = await Promise.all(
      periods.map(async (p) => {
        const dateRange = getDateRange(p);
        return Order.find({
          orderDate: {
            $gte: dateRange.start,
            $lte: dateRange.end
          },
          status: "Delivered"
        }).sort({ orderDate: -1 });
      })
    );

    const [dailyOrders, weeklyOrders, monthlyOrders, annualOrders] = filteredOrders;

    res.render("admin/salesReport", {
      allOrders: orderDetails,
      dailyOrders,
      weeklyOrders,
      monthlyOrders,
      annualOrders,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
      title: "Sales Report",
      selectedPeriod: period
    });
  } catch (error) {
    console.error("Failed to render the sales report:", error);
    res.status(500).send("Failed to render the sales report");
  }
};

export const exportSalesReport = async (req, res) => {
  try {
    const period = req.query.period || 'all';
    let dateFilter = {};
    
    if (period !== 'all') {
      const dateRange = getDateRange(period);
      dateFilter = {
        orderDate: {
          $gte: dateRange.start,
          $lte: dateRange.end
        },
        status: "Delivered"
      };
    }

    const orders = await Order.find(dateFilter).sort({ orderDate: -1 });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');

    // Define columns
    worksheet.columns = [
      { header: 'Order ID', key: '_id', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 30 },
      { header: 'Order Date', key: 'orderDate', width: 20 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Discount', key: 'discount', width: 15 },
      { header: 'Offer Discount', key: 'offerDiscount', width: 15 },
      { header: 'Coupon Discount', key: 'couponDiscount', width: 15 },
      { header: 'Cutoff Amount', key: 'cutoffAmount', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Payment Method', key: 'paymentMethod', width: 20 },
      { header: 'Status', key: 'status', width: 15 },
    ];

    // Add rows
    orders.forEach(order => {
      worksheet.addRow(formatOrderData(order));
    });

    // Set headers and send response
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sales_report_${period}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Failed to export sales report:', error);
    res.status(500).send('Failed to export sales report');
  }
};


export const exportSalesReportPdf = async (req, res) => {
  try {
    const period = req.query.period || 'all';
    let dateFilter = {};

    if (period === 'custom') {
      // Validate dates before creating Date objects
      const startDateStr = req.query.startDate;
      const endDateStr = req.query.endDate;

      if (!startDateStr || !endDateStr) {
        return res.status(400).send('Start date and end date are required for custom date range');
      }

      // Create dates at the start and end of the respective days
      const startDate = new Date(startDateStr);
      const endDate = new Date(endDateStr);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return res.status(400).send('Invalid date format. Please use YYYY-MM-DD format');
      }

      // Set time to start of day for start date and end of day for end date
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      dateFilter = {
        orderDate: {
          $gte: startDate,
          $lte: endDate
        },
        status: "Delivered" // Add status filter here
      };

      console.log('Date Filter:', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      });
    } else if (period !== 'all') {
      const dateRange = getDateRange(period);
      dateFilter = {
        orderDate: {
          $gte: dateRange.start,
          $lte: dateRange.end
        },
        status: "Delivered"
      };
    } else {
      // If period is 'all', only filter by status
      dateFilter = {
        status: "Delivered"
      };
    }

    // Debug log
    console.log('Final Date Filter:', dateFilter);
    
    const orders = await Order.find(dateFilter)
      .populate({
        path: 'address.user',
        select: 'name email joined_date phone_number'
      })
      .sort({ orderDate: -1 });

    // Debug log
    console.log('Orders found:', orders.length);

    if (!orders || orders.length === 0) {
      return res.status(404).send('No orders found for the selected period');
    }

    // Calculate sales summary
    const summary = {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, order) => sum + order.subtotal, 0),
      totalDiscount: orders.reduce((sum, order) => sum + order.discount + order.offerDiscount + order.couponDiscount, 0),
      averageOrderValue: orders.length ? orders.reduce((sum, order) => sum + order.subtotal, 0) / orders.length : 0
    };

    // Initialize PDF
    const doc = new jsPDF('landscape');

    // Add header information
    doc.setFontSize(18);
    doc.text("ToyHub", 14, 10);
    doc.setFontSize(12);
    doc.text("Sales Report", 14, 20);

    // Update period text for custom date range
    let periodText = period;
    if (period === 'custom') {
      periodText = `${new Date(req.query.startDate).toISOString().split('T')[0]} - ${new Date(req.query.endDate).toISOString().split('T')[0]}`;
    } else {
      periodText = period.charAt(0).toUpperCase() + period.slice(1);
    }
    doc.text(`Period: ${periodText}`, 14, 30);
    doc.text(`Generated on: ${new Date().toISOString().split('T')[0]}`, 14, 40);

    // Add summary section
    doc.setFontSize(14);
    doc.text("Sales Summary", 14, 55);
    doc.setFontSize(12);
    doc.text(`Total Orders: ${summary.totalOrders}`, 14, 65);
    doc.text(`Total Revenue: ₹${summary.totalRevenue.toFixed(2)}`, 14, 75);
    doc.text(`Total Discounts: ₹${summary.totalDiscount.toFixed(2)}`, 14, 85);
    doc.text(`Average Order Value: ₹${summary.averageOrderValue.toFixed(2)}`, 14, 95);

    // Define table columns
    const tableColumn = [
      { header: "S.No", dataKey: "sno", width: 10 },
      { header: "Order ID", dataKey: "_id", width: 40 },
      { header: "Name", dataKey: "customerName", width: 20 },
      { header: "Date", dataKey: "orderDate", width: 40 },
      { header: "Address", dataKey: "address", width: 50 },
      { header: "Total", dataKey: "totalAmount", width: 12 },
      { header: "Discount", dataKey: "discount", width: 12 },
      { header: "Offer", dataKey: "offerDiscount", width: 12 },
      { header: "Coupon", dataKey: "couponDiscount", width: 12 },
      { header: "Cutoff", dataKey: "cutoffAmount", width: 12 },
      { header: "Subtotal", dataKey: "subtotal", width: 12 },
      { header: "Payment", dataKey: "paymentMethod", width: 25 },
      { header: "Status", dataKey: "status", width: 20 }
    ];

    // Prepare table data with formatted dates
    const tableRows = orders.map((order, index) => ({
      ...formatOrderData(order),
      orderDate: new Date(order.orderDate).toISOString(),
      sno: index + 1
    }));

    // Generate table
    doc.autoTable({
      columns: tableColumn,
      body: tableRows,
      startY: 105,
      theme: 'grid',
      columnStyles: {
        _id: { cellWidth: 40 },
        sno: { cellWidth: 10 },
        customerName: { cellWidth: 20 },
        orderDate: { cellWidth: 40 },
        address: { cellWidth: 50 },
        totalAmount: { cellWidth: 12 },
        discount: { cellWidth: 12 },
        offerDiscount: { cellWidth: 12 },
        couponDiscount: { cellWidth: 12 },
        cutoffAmount: { cellWidth: 12 },
        subtotal: { cellWidth: 12 },
        paymentMethod: { cellWidth: 25 },
        status: { cellWidth: 20 }
      }
    });

    // Send response
    const pdfOutput = doc.output();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=sales_report_${period}.pdf`);
    res.send(Buffer.from(pdfOutput, 'binary'));
  } catch (error) {
    console.error('Failed to export sales report as PDF:', error);
    res.status(400).send(error.message || 'Failed to export sales report as PDF');
  }
};

export default {
  getSalesReport,
  exportSalesReport,
  exportSalesReportPdf
};