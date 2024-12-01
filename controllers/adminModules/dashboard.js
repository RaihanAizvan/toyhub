import Order from "../../models/orders.models.js"
import Product from "../../models/product.models.js"
import Category from "../../models/categories.model.js"
import Offer from "../../models/offers.models.js"
import Coupon from "../../models/couponSchema.models.js"
import User from "../../models/users.models.js"
import Address from "../../models/address.models.js"

export async function getHome(req, res) {
  console.log('Checking if admin is authenticated');
  if (!req.session.sAdminEmail) {
    console.log('Admin not authenticated, redirecting to /admin/login');
    return res.redirect("/admin/login") // Redirect to login if not authenticated
  }
  console.log('Admin authenticated');
  const orders = await Order.find({}).limit(10).sort({orderDate:-1}).populate('items.product')
  const todaysOrder = await Order.find({orderDate:{$gte:new Date(new Date().setHours(0,0,0,0))}}).sort({orderDate:-1}).populate('items.product')
  const products = await Product.find({isBlocked:false}).limit(5)
  const addresses = await Address.find({}).limit(5)
  const fullOrders = await Order.find({})


    // Check if the admin is authenticated

    const totalOrders = orders.reduce((acc,order)=>acc+order.totalAmount,0)
    const totalUsers = await User.countDocuments({})
    const todaysRevenue = todaysOrder.reduce((acc,order)=>acc+order.totalAmount,0)
    const activeOrders = fullOrders.length
 
    const bestSellingCategories = await Category.find({isActive:true}).limit(5)
    const bestSellingProducts = await Product.find({}).sort({sold:-1}).limit(5)
    const bestSellingUsers = await User.find({}).limit(5)
    const bestSellingLocations = addresses.map(address=>address.city)

    res.set("Cache-Control", "no-store")
    res.render("admin/adminHome",{
      orders,
      bestSellingCategories,
      bestSellingProducts,
      bestSellingUsers,
      bestSellingLocations,
      totalOrders,
      totalUsers,
      todaysRevenue,
      activeOrders
    })
  }



//*Weekly Sales


export async function getWeeklySales(req, res) {

  const orders = await Order.find({

    orderDate: { $gte: new Date(new Date().setDate(new Date().getDate() - 7)) }

  }).sort({ orderDate: -1 });


  const salesData = new Array(7).fill(0); // Initialize 7 days with 0

  orders.forEach(order => {

    const dayIndex = 6 - Math.floor((new Date() - order.orderDate) / (1000 * 60 * 60 * 24));

    if (dayIndex >= 0 && dayIndex < 7) {

      salesData[dayIndex] += order.totalAmount;

    }

  });
  // Round sales data to two decimal places
  const roundedSalesData = salesData.map(amount => parseFloat(amount.toFixed(2)));

  res.json({ salesData: roundedSalesData });
}



//*Monthly Sales



export async function getMonthlySales(req, res) {

  const orders = await Order.find({

    orderDate: { $gte: new Date(new Date().setDate(new Date().getDate() - 30)) }

  }).sort({ orderDate: -1 });


  const salesData = new Array(4).fill(0); // Initialize 4 weeks with 0

  orders.forEach(order => {

    const weekIndex = Math.floor((30 - (new Date() - order.orderDate) / (1000 * 60 * 60 * 24)) / 7);

    if (weekIndex >= 0 && weekIndex < 4) {

      salesData[weekIndex] += order.totalAmount;

    }

  });

  // Round sales data to two decimal places
  const roundedSalesData = salesData.map(amount => parseFloat(amount.toFixed(2)));

  res.json({ salesData: roundedSalesData });

}


//*Yearly Sales


export async function getYearlySales(req, res) {


    const orders = await Order.find({

        orderDate: { $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1)) }

        }).sort({ orderDate: -1 });


      const salesData = new Array(12).fill(0); // Initialize 12 months with 0

      orders.forEach(order => {


        const monthIndex = new Date(order.orderDate).getMonth();

        salesData[monthIndex] += order.totalAmount;

      });

      // Round sales data to two decimal places
      const roundedSalesData = salesData.map(amount => parseFloat(amount.toFixed(2)));

      res.json({ salesData: roundedSalesData });

}
  

  export default {
    getHome,
    getWeeklySales,
    getMonthlySales,
    getYearlySales
  }