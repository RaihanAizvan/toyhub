//! simulating admin details only for debugging
//todo: change this to close debugging
const adminCred = {
  email: "admin@gmail.com",
  password: "admin",
}

// function for rendering admin home page !
export function getHome(req, res) {
  // Check if the user is authenticated
  if (!req.session.sAdminEmail) {
    return res.redirect("/admin/login") // Redirect to login if not authenticated
  }
  res.set("Cache-Control", "no-store")
  res.render("admin/adminHome")
}

// function for rendering admin  homepage
export function getLogin(req, res) {
  console.log(`session email:- ${req.session.sAdminEmail}`)
  if (req.session.sAdminEmail) {
    return res.redirect("/admin")
  }
  res.set("Cache-Control", "no-store")
  res.render("admin/adminLogin")
}

// function for sending login detials
export function postLogin(req, res) {
  if (
    req.body.email == adminCred.email &&
    req.body.password == adminCred.password
  ) {
    req.session.sAdminEmail = req.body.email
    req.session.sAdminPassword = req.body.password
    res.redirect("/admin")
    console.log("Succesfull login")
  } else {
    res.render("admin/adminLogin", { error: "Incorrect password" })
    console.log("login failed")
    return
  }
}

// function for logging out
export function postLogout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect("/admin") // Redirect to home on error
    }
    res.redirect("/admin/login") // Redirect to login on successful logout
  })
}

export default {
  getHome,
  getLogin,
  postLogin,
  postLogout,
}
