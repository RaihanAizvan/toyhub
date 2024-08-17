export function getHome(req, res) {
    // Check if the user is authenticated
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin/login") // Redirect to login if not authenticated
    }
    res.set("Cache-Control", "no-store")
    res.render("admin/adminHome")
  }

  export default {
    getHome
  }