
//! ------------------------------------------------------!
//                                                        |                                          
//!                   Importing Modules                   |
//                                                        |
//--------------------------------------------------------!

//todo ------------------Auth Routes---------------------!

import AdminLogin from "./adminModules/login.js"

//todo ------------------Dashboard Routes---------------------!

import AdminHome from "./adminModules/dashboard.js"

//todo ----------------Product Routes--------------------!

import product from "./adminModules/addProducts.js"
import productList from "./adminModules/productList.js"

//todo ----------------category Routes--------------------!

import category from "./adminModules/addCategory.js"

//todo: -----------------User list Routes-----------------!

import user from "./adminModules/users.js"
import block from "./adminModules/block.js"

//todo: -----------------Order list Routes-----------------!

import order from "./adminModules/order.js"

//todo: -----------------Coupon list Routes-----------------!

import coupon from "./adminModules/coupon.js"


//! ------------------------------------------------------!
//                                                        |                                        
//!                   Exporting Modules                   |
//                                                        |                         
//--------------------------------------------------------!


//todo ------------------Auth Routes----------------------!

export const getLogin = AdminLogin.getLogin
export const postLogin = AdminLogin.postLogin
export const postLogout = AdminLogin.postLogout

//todo ---------------Dashboard Routes---------------------!

export const getHome = AdminHome.getHome

//todo ----------------Product Routes----------------------!

// Exporting the getAddProduct function from product module
export const getAddProduct = product.getAddProduct
export const postAddProduct = product.postAddProduct
export const getProductList = productList.getProductList
export const getEditProduct = productList.getEditProduct
export const postEditProduct = productList.postEditProduct
export const postBlockProduct = productList.postBlockProduct
//todo ----------------category Routes----------------------!

export const getAddCategory = category.getAddCategory
export const postAddCategory = category.postAddCategory
export const getEditCategory = category.getEditCategory
export const postEditCategory = category.postEditCategory
export const postDeleteCategory = category.postDeleteCategory


//todo: -----------------User list Routes-----------------!

export const getUserlist = user.getUserList

//todo: -----------------User block Routes-----------------!

export const postBlock = block.postBlock

//todo: -----------------Order list Routes-----------------!

export const getAdminOrders = order.getAdminOrders
export const getAdminOrderDetails = order.getAdminOrderDetails
export const postUpdateOrderStatus = order.postUpdateOrderStatus

//todo: -----------------Coupon list Routes-----------------!

export const getCoupon = coupon.getCoupon
export const getAddCoupon = coupon.getAddCoupon
export const postAddCoupon = coupon.postAddCoupon
export const postBlockCoupon = coupon.postBlockCoupon
export const postDeleteCoupon = coupon.postDeleteCoupon
export const getEditCoupon = coupon.getEditCoupon
export const postEditCoupon = coupon.postEditCoupon
<<<<<<< HEAD

=======
>>>>>>> coupon

