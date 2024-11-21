//this commet is for track the previous git commmit
// sales reported already completed in the previous commit
// i forgot to add the commit message so i am adding it now

import Order from "../../models/orders.models.js"
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
export const getSalesReport = async (req, res) => {
  try {

    // Extract page and limit from query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Extract Order details from the Database
    let orderDetails = await Order.find()
      .sort({ orderDate: -1 })
      .skip(skip)
      .limit(limit);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    console.log("Start of day:", startOfDay);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    console.log("End of day:", endOfDay);

    const today = new Date();
    console.log("Today's date:", today);

    // Get the start of the week (assuming the week starts on Monday)
    const startOfWeek = new Date(today);
    const dayOfWeek = startOfWeek.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(startOfWeek.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);
    console.log("Start of week:", startOfWeek);

    // Get the end of the week (assuming the week ends on Sunday)
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    console.log("End of week:", endOfWeek);

    // Set the start of the month
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    console.log("Start of month:", startOfMonth);

    // Set the end of the month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);
    console.log("End of month:", endOfMonth);

    // Set the start of the year
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    startOfYear.setHours(0, 0, 0, 0);
    console.log("Start of year:", startOfYear);

    // Set the end of the year
    const endOfYear = new Date(today.getFullYear(), 11, 31);
    endOfYear.setHours(23, 59, 59, 999);

    // Extract daily order details
    const dailyOrders = await Order.find({
      orderDate: {
        $gte: startOfDay,
        $lt: endOfDay,
      },
      status: "Delivered"
    }).sort({ orderDate: -1 });

    // Extract weekly order details
    const weeklyOrders = await Order.find({
      orderDate: {
        $gte: startOfWeek,
        $lt: endOfWeek,
      },
      status: "Delivered"
    }).sort({ orderDate: -1 });

    // Extract monthly order details
    const monthlyOrders = await Order.find({
      orderDate: {
        $gte: startOfMonth,
        $lt: endOfMonth,
      },
      status: "Delivered"
    }).sort({ orderDate: -1 });

    // Extract annual order details
    const annualOrders = await Order.find({
      orderDate: {
        $gte: startOfYear,
        $lt: endOfYear,
      },
      status: "Delivered"
    }).sort({ orderDate: -1 });

    // Render the sales report page

    res.render("admin/salesReport", {
      allOrders: orderDetails,
      dailyOrders,
      weeklyOrders,
      monthlyOrders,
      annualOrders,
      currentPage: page,
      totalPages: Math.ceil(orderDetails.length / limit),
      title: "Sales Report"
    });
  } catch (error) {
    // Log any errors that occur during the rendering process
    console.error("Failed to render the sales report:", error);

    // Send a 500 Internal Server Error response if an error occurs
    res.status(500).send("Failed to render the sales report");
  }

}



export const exportSalesReport = async (req, res) => {
  try {
    const { filter, startDate, endDate } = req.query;
    let dateFilter = {};

    if (startDate && endDate) {
      dateFilter = { orderDate: { $gte: new Date(startDate), $lt: new Date(endDate) } };
    } else {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const startOfWeek = new Date(today);
      const dayOfWeek = startOfWeek.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      startOfWeek.setDate(startOfWeek.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const startOfYear = new Date(today.getFullYear(), 0, 1);
      startOfYear.setHours(0, 0, 0, 0);
      const endOfYear = new Date(today.getFullYear(), 11, 31);
      endOfYear.setHours(23, 59, 59, 999);

      switch (filter) {
        case 'daily':
          dateFilter = { orderDate: { $gte: startOfDay, $lt: endOfDay } };
          break;
        case 'weekly':
          dateFilter = { orderDate: { $gte: startOfWeek, $lt: endOfWeek } };
          break;
        case 'monthly':
          dateFilter = { orderDate: { $gte: startOfMonth, $lt: endOfMonth } };
          break;
        case 'annual':
          dateFilter = { orderDate: { $gte: startOfYear, $lt: endOfYear } };
          break;
        default:
          dateFilter = {};
      }
    }

    const orders = await Order.find(dateFilter);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sales Report');

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

    orders.forEach(order => {
      worksheet.addRow({
        _id: order._id,
        customerName: order.address.user.name,
        orderDate: order.orderDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        address: `${order.address.street}, ${order.address.city}, ${order.address.state}, ${order.address.zip}`,
        totalAmount: order.totalAmount,
        discount: order.discount,
        offerDiscount: order.offerDiscount,
        couponDiscount: order.couponDiscount,
        cutoffAmount: order.cutoffAmount,
        subtotal: order.subtotal,
        paymentMethod: order.paymentMethod,
        status: order.status,
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=sales_report.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Failed to export sales report:', error);
    res.status(500).send('Failed to export sales report');
  }
}

export const exportSalesReportPdf = async (req, res) => {
  try {
    const { filter, startDate, endDate } = req.query;
    let dateFilter = {};

    if (startDate && endDate) {
      dateFilter = { orderDate: { $gte: new Date(startDate), $lt: new Date(endDate) } };
    } else {
      const today = new Date();
      const startOfDay = new Date(today);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(today);
      endOfDay.setHours(23, 59, 59, 999);

      const startOfWeek = new Date(today);
      const dayOfWeek = startOfWeek.getDay();
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      startOfWeek.setDate(startOfWeek.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const startOfYear = new Date(today.getFullYear(), 0, 1);
      startOfYear.setHours(0, 0, 0, 0);
      const endOfYear = new Date(today.getFullYear(), 11, 31);
      endOfYear.setHours(23, 59, 59, 999);

      switch (filter) {
        case 'daily':
          dateFilter = { orderDate: { $gte: startOfDay, $lt: endOfDay } };
          break;
        case 'weekly':
          dateFilter = { orderDate: { $gte: startOfWeek, $lt: endOfWeek } };
          break;
        case 'monthly':
          dateFilter = { orderDate: { $gte: startOfMonth, $lt: endOfMonth } };
          break;
        case 'annual':
          dateFilter = { orderDate: { $gte: startOfYear, $lt: endOfYear } };
          break;
        default:
          dateFilter = {};
      }
    }

    const orders = await Order.find(dateFilter);

    // Initialize jsPDF with landscape orientation
    const doc = new jsPDF('landscape');

    // Add ToyHub and other details at the top
    doc.setFontSize(18);
    doc.text("ToyHub", 14, 10);
    doc.setFontSize(12);
    doc.text("Sales Report", 14, 20);
    doc.text(`Date: ${new Date().toLocaleDateString('en-US')}`, 14, 30);
    doc.text("All rights reserved © 2024 ToyHub", 14, 40);

    const tableColumn = [
      { header: "S.No", dataKey: "sno", width: 10 },
      { header: "Order ID", dataKey: "_id", width: 40 },
      { header: "Name", dataKey: "customerName", width: 20 },
      { header: "Date", dataKey: "orderDate", width: 40 },
      { header: "Address", dataKey: "address", width: 50 },
      { header: "Total", dataKey: "totalAmount", width: 12 },
      { header: "Discount", dataKey: "discount", width: 12 },
      { header: "Offer", dataKey: "offerDiscount", width: 12 },
      { header: "Coupon ", dataKey: "couponDiscount", width: 12 },
      { header: "Cutoff", dataKey: "cutoffAmount", width: 12 },
      { header: "Subtotal", dataKey: "subtotal", width: 12 },
      { header: "Payment Method", dataKey: "paymentMethod", width: 25 },
      { header: "Status", dataKey: "status", width: 20 }
    ];

    const tableRows = [];

    orders.forEach(order => {
      const orderData = {
        _id: order._id,
        sno: tableRows.length + 1,
        customerName: order.address.user.name,
        orderDate: new Date(order.orderDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        address: `${order.address.street}, ${order.address.city}, ${order.address.state}, ${order.address.zip}`,
        totalAmount: order.totalAmount,
        discount: order.discount,
        offerDiscount: order.offerDiscount,
        couponDiscount: order.couponDiscount,
        cutoffAmount: order.cutoffAmount,
        subtotal: order.subtotal,
        paymentMethod: order.paymentMethod,
        status: order.status
      };
      tableRows.push(orderData);
    });

    doc.autoTable({
      columns: tableColumn,
      body: tableRows,
      startY: 50,
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

    const pdfOutput = doc.output();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=sales_report.pdf');
    res.send(Buffer.from(pdfOutput, 'binary'));
  } catch (error) {
    console.error('Failed to export sales report as PDF:', error);
    res.status(500).send('Failed to export sales report as PDF');
  }
}

export default {
    getSalesReport,
    exportSalesReport,
    exportSalesReportPdf
}
