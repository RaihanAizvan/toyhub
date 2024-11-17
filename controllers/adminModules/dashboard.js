import Order from "../../models/orders.models.js"
import Product from "../../models/product.models.js"

export async function getHome(req, res) {

  const orders = await Order.find({}).limit(10).sort({orderDate:-1}).populate('items.product')
  const products = await Product.find({isBlocked:false}).limit(5)
    // Check if the admin is authenticated
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin/login") // Redirect to login if not authenticated
    }
    res.set("Cache-Control", "no-store")
    res.render("admin/adminHome",{orders,bestSellers: products})
  }

  export default {
    getHome
  }