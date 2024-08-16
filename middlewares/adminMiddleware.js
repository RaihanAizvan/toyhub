function isAdmin(req, res, next) {
  if (req.session && req.session.sAdminEmail) {
    next()
    console.log("admin middleware passed")
  } else {
    res.status(403).redirect("/admin/login")
    console.log("middleware failed")
  }
}
export default isAdmin
