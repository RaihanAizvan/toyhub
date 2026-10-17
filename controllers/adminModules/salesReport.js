import Order, { normaliseOrderStatus } from "../../models/orders.models.js"
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  averageOrderValue,
  customWindow,
  isSalesReportPeriod,
  orderDateFilterFor,
  revenueOf,
  revenueOrderCount,
  totalDiscountOf,
} from "../../utils/reports.js";

// One period filter serves the page, the spreadsheet and the pdf, so all three
// describe the same rows. A custom period is validated before a window can be
// built from it, and an unknown period name quietly means "all".
const dateFilterFor = (period, query) => {
  if (period === "custom") {
    const window = customWindow(query.startDate, query.endDate);
    return window ? { orderDate: { $gte: window.start, $lt: window.end } } : null;
  }
  return orderDateFilterFor(period);
};

// The rows all read one shape: a name even when the buyer is gone, a date even
// when the shipment is lost, a status in today's words.
const formatOrderData = (order) => {
  const address = order.address || {};
  const street = [address.street, address.city, address.state, address.zip]
    .filter(Boolean)
    .join(", ");
  return {
    _id: order._id,
    customerName:
      order.user?.name || order.address?.name || "A deleted account",
    orderDate: order.orderDate
      ? new Date(order.orderDate).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Unknown",
    address: street || order.address?.name || "Address not recorded",
    totalAmount: Number(order.totalAmount) || 0,
    discount: Number(order.discount) || 0,
    offerDiscount: Number(order.offerDiscount) || 0,
    couponDiscount: Number(order.couponDiscount) || 0,
    cutoffAmount: Number(order.cutoffAmount) || 0,
    subtotal: Number(order.subtotal) || 0,
    paymentMethod: order.paymentMethod || "N/A",
    status: normaliseOrderStatus(order.status),
  };
};

export const getSalesReport = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit, 10) || 10),
    );
    const period = isSalesReportPeriod(req.query.period)
      ? req.query.period
      : "all";
    const dateFilter = dateFilterFor(period, req.query);

    if (period === "custom" && !dateFilter) {
      return res
        .status(400)
        .send(
          "A custom report needs two real YYYY-MM-DD dates, with the start no later than the end",
        );
    }

    const skip = (page - 1) * limit;
    const [orders, totalCount, periodOrders] = await Promise.all([
      Order.find(dateFilter)
        .populate("user", "name")
        .sort({ orderDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(dateFilter),
      Order.find(dateFilter)
        .select("totalAmount discount offerDiscount couponDiscount status")
        .lean(),
    ]);

    res.render("admin/salesReport", {
      title: "Sales Report",
      selectedPeriod: period,
      startDate: period === "custom" ? req.query.startDate : "",
      endDate: period === "custom" ? req.query.endDate : "",
      orders: orders.map((order) => ({
        ...order,
        status: normaliseOrderStatus(order.status),
      })),
      summary: {
        totalOrders: revenueOrderCount(periodOrders),
        totalRevenue: revenueOf(periodOrders),
        totalDiscount: totalDiscountOf(periodOrders),
        averageOrderValue: averageOrderValue(periodOrders),
      },
      currentPage: page,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      totalCount,
    });
  } catch (error) {
    console.error("Failed to render the sales report:", error);
    res.status(500).send("Failed to render the sales report");
  }
};

export const exportSalesReport = async (req, res) => {
  try {
    const period = isSalesReportPeriod(req.query.period)
      ? req.query.period
      : "all";
    const dateFilter = dateFilterFor(period, req.query);

    if (period === "custom" && !dateFilter) {
      return res
        .status(400)
        .send(
          "A custom report needs two real YYYY-MM-DD dates, with the start no later than the end",
        );
    }

    const orders = await Order.find(dateFilter).sort({ orderDate: -1 }).lean();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Sales Report");

    worksheet.columns = [
      { header: "Order ID", key: "_id", width: 20 },
      { header: "Customer Name", key: "customerName", width: 30 },
      { header: "Order Date", key: "orderDate", width: 20 },
      { header: "Address", key: "address", width: 40 },
      { header: "Total Amount", key: "totalAmount", width: 15 },
      { header: "Discount", key: "discount", width: 15 },
      { header: "Offer Discount", key: "offerDiscount", width: 15 },
      { header: "Coupon Discount", key: "couponDiscount", width: 15 },
      { header: "Cutoff Amount", key: "cutoffAmount", width: 15 },
      { header: "Subtotal", key: "subtotal", width: 15 },
      { header: "Payment Method", key: "paymentMethod", width: 20 },
      { header: "Status", key: "status", width: 15 },
    ];

    orders.forEach((order) => {
      worksheet.addRow(formatOrderData(order));
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales_report_${period}.xlsx`,
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Failed to export sales report:", error);
    res.status(500).send("Failed to export sales report");
  }
};

export const exportSalesReportPdf = async (req, res) => {
  try {
    const period = isSalesReportPeriod(req.query.period)
      ? req.query.period
      : "all";
    const dateFilter = dateFilterFor(period, req.query);

    if (period === "custom" && !dateFilter) {
      return res
        .status(400)
        .send(
          "A custom report needs two real YYYY-MM-DD dates, with the start no later than the end",
        );
    }

    const orders = await Order.find(dateFilter)
      .populate({ path: "user", select: "name" })
      .sort({ orderDate: -1 })
      .lean();

    const summary = {
      totalOrders: revenueOrderCount(orders),
      totalRevenue: revenueOf(orders),
      totalDiscount: totalDiscountOf(orders),
      averageOrderValue: averageOrderValue(orders),
    };

    const doc = new jsPDF("landscape");

    doc.setFontSize(18);
    doc.text("ToyHub", 14, 10);
    doc.setFontSize(12);
    doc.text("Sales Report", 14, 20);

    let periodText = period.charAt(0).toUpperCase() + period.slice(1);
    if (period === "custom") {
      periodText = `${req.query.startDate} - ${req.query.endDate}`;
    }
    doc.text(`Period: ${periodText}`, 14, 30);
    doc.text(
      `Generated on: ${new Date().toISOString().split("T")[0]}`,
      14,
      40,
    );

    doc.setFontSize(14);
    doc.text("Sales Summary", 14, 55);
    doc.setFontSize(12);
    doc.text(`Total Orders: ${summary.totalOrders}`, 14, 65);
    doc.text(`Total Revenue: ₹${summary.totalRevenue.toFixed(2)}`, 14, 75);
    doc.text(`Total Discounts: ₹${summary.totalDiscount.toFixed(2)}`, 14, 85);
    doc.text(
      `Average Order Value: ₹${summary.averageOrderValue.toFixed(2)}`,
      14,
      95,
    );

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
      { header: "Status", dataKey: "status", width: 20 },
    ];

    const tableRows = orders.map((order, index) => ({
      ...formatOrderData(order),
      sno: index + 1,
    }));

    if (tableRows.length > 0) {
      autoTable(doc, {
        columns: tableColumn,
        body: tableRows,
        startY: 105,
        theme: "grid",
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
          status: { cellWidth: 20 },
        },
      });
    } else {
      doc.setFontSize(12);
      doc.text("No orders match this period.", 14, 110);
    }

    const pdfOutput = doc.output();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=sales_report_${period}.pdf`,
    );
    res.send(Buffer.from(pdfOutput, "binary"));
  } catch (error) {
    console.error("Failed to export sales report as PDF:", error);
    res.status(400).send(error.message || "Failed to export sales report as PDF");
  }
};

export default {
  getSalesReport,
  exportSalesReport,
  exportSalesReportPdf,
};