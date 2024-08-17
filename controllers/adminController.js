//

//

//

//! -----------------Importing modules-------------------

// Importing the AdminLogin module which contains login related functions
import AdminLogin from "./adminModules/login.js"

// Importing the AdminHome module which contains dashboard related functions
import AdminHome from "./adminModules/dashboard.js"

// Importing the product module which contains add product related functions
import product from "./adminModules/addProducts.js"

//! -----------------Exporting modules-------------------

// Exporting the getLogin function from AdminLogin module
export const getLogin = AdminLogin.getLogin

// Exporting the postLogin function from AdminLogin module
export const postLogin = AdminLogin.postLogin

// Exporting the postLogout function from AdminLogin module
export const postLogout = AdminLogin.postLogout

// Exporting the getHome function from AdminHome module
export const getHome = AdminHome.getHome

// Exporting the getAddProduct function from product module
export const getAddProduct = product.getAddProduct
