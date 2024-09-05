
//! ------------------------------------------------------!
//                                                        |                                          
//!                   Importing Modules                   |
//                                                        |
//--------------------------------------------------------!

//todo ------------------Auth Routes---------------------!

// Importing the AdminLogin module which contains login related functions
import AdminLogin from "./adminModules/login.js"

//todo ------------------Dashboard Routes---------------------!

// Importing the AdminHome module which contains dashboard related functions
import AdminHome from "./adminModules/dashboard.js"

//todo ----------------Product Routes--------------------!

// Importing the product module which contains add product related functions
import product from "./adminModules/addProducts.js"

//todo ----------------category Routes--------------------!

import category from "./adminModules/addCategory.js"




//todo: -----------------User list Routes-----------------!

// Importinf the User module which contains get user related functions
import user from "./adminModules/users.js"

//This is for blocking the user nad also unbloacking
import block from "./adminModules/block.js"

//! ------------------------------------------------------!
//                                                        |                                        
//!                   Exporting Modules                   |
//                                                        |                         
//--------------------------------------------------------!


//todo ------------------Auth Routes----------------------!

// Exporting the getLogin function from AdminLogin module
export const getLogin = AdminLogin.getLogin

// Exporting the postLogin function from AdminLogin module
export const postLogin = AdminLogin.postLogin

// Exporting the postLogout function from AdminLogin module
export const postLogout = AdminLogin.postLogout

//todo ---------------Dashboard Routes---------------------!

// Exporting the getHome function from AdminHome module
export const getHome = AdminHome.getHome

//todo ----------------Product Routes----------------------!

// Exporting the getAddProduct function from product module
export const getAddProduct = product.getAddProduct

export const postAddProduct = product.postAddProduct


//todo ----------------category Routes----------------------!

export const getAddCategory = category.getAddCategory
export const postAddCategory = category.postAddCategory
export const getEditCategory = category.getEditCategory
export const postEditCategory = category.postEditCategory
export const postDeleteCategory = category.postDeleteCategory


//todo: -----------------User list Routes-----------------!

// exporting the getUserlist function to show the user details
export const getUserlist = user.getUserList


//todo: -----------------User block Routes-----------------!

// exporting the getUserlist function to show the user details
export const postBlock = block.postBlock



