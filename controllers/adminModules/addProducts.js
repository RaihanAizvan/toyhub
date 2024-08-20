export function getAddProduct(req, res) {
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin")
    }
    res.set("Cache-Control", "no-store")
   res.render("admin/addProduct")
  }

  export default {
    getAddProduct,
  }