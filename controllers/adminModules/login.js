import AdminUser from '../../models/admin/adminUser.js';


async function getAdminCredentials() {
    try {
      const admin = await AdminUser.findOne({ role: 'superadmin' });
      if (admin) {
        return {
          email: admin.email,
          password: admin.password,
        };
      } else {
        throw new Error('Admin user not found');
      }
    } catch (error) {
      console.error('Error fetching admin credentials:', error);
      throw error;
    }
  }
  // creating new admin using the function
  let adminCred = {};
  getAdminCredentials()
    .then(credentials => {
      adminCred = credentials;
    })
    .catch(error => console.error('Error:', error));
  
  export function getLogin(req, res) {
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
      res.set("Cache-control", "no-store")
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
    getLogin,
    postLogin,
    postLogout,
  };
