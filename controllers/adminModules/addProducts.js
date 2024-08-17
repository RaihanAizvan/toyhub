export function getAddProduct(req, res) {
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin")
    }
   res.render("admin/addProduct")
   res.set("Cache-Control", "no-store")
  }

  export default {
    getAddProduct,
  }