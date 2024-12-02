
//? *******************************************************************!                                         
//?                          Importing Modules                         |
//*********************************************************************!

//* -----------------------------------------!                                         
//s       Importing Authentication           |
//* -----------------------------------------!                                         

import userAuthentication from "./userModules/auth.js"

//* -----------------------------------------!                                         
//s       Importing LandingPage              |
//* -----------------------------------------!                                         

import landingPage from "./userModules/landing.js"

//* -----------------------------------------!                                         
//s       Importing productPage              |
//* -----------------------------------------!                                         

import singleProduct from "./userModules/singleProduct.js"


//* -----------------------------------------!                                         
//s       Importing category                 |
//* -----------------------------------------!                                         

import category from "./userModules/category.js"


//* -----------------------------------------!                                         
//s       Importing Profile                  |
//* -----------------------------------------!                                         

import profile from "./userModules/profile.js"

//* -----------------------------------------!                                         
//s       Importing Profile                  |
//* -----------------------------------------!       

import address from "./userModules/address.js"

//* -----------------------------------------!                                         
//s       Importing Cart                     |
//* -----------------------------------------!       

import cart from "./userModules/cart.js"


//* -----------------------------------------!                                         
//s       Importing checkout                 |
//* -----------------------------------------!     

import checkout from "./userModules/checkout.js"


//todo: --------------------------------------!

//? *******************************************************************!                                      
//?                          Exporting Modules                         |                        
// ********************************************************************!

//* -----------------------------------------!                                         
//s       Exporting Authentication           |
//* -----------------------------------------!                                         

export const postSignup = userAuthentication.postSignup

export const getSignup = userAuthentication.getSignup

export const getOtp = userAuthentication.getOtp

export const postOtp = userAuthentication.postOtp

export const getLogin = userAuthentication.getLogin

export const postLogin = userAuthentication.postLogin

export const postResentOtp = userAuthentication.postResendOtp

export const getLogout = userAuthentication.getLogout

//* -----------------------------------------!                                         
//s       Exporting landingPage              |
//* -----------------------------------------!      

export const getLandingPage = landingPage.getLandingPage

export const getProductsByCategory = category.getProductsByCategory

export const getCategoryList = category.getCategoryList

export const viewAllCategories = category.viewAllCategories



//* -----------------------------------------!                                         
//s     Exporting singleproductPage          |
//* -----------------------------------------!      


export const getSingleProduct = singleProduct.getSingleProduct

export const searchAndFilterProducts = singleProduct.searchAndFilterProducts

export const searchProducts = singleProduct.searchProducts

export const submitReview = singleProduct.submitReview



//* -----------------------------------------!                                         
//s     Exporting profiles                   |
//* -----------------------------------------!      

export const getProfileEdit = profile.getProfileEdit

export const postUpdateName = profile.postUpdateName

export const postUpdatePhone = profile.postUpdatePhone

export const getOrderHistory = profile.getOrderHistory

export const getOrderDetail = profile.getOrderDetail

export const postOrderCancel = profile.postOrderCancel

export const getCancelReason = profile.getCancelReason

export const postItemCancel = profile.postItemCancel

export const postDownloadInvoice = profile.postDownloadInvoice

export const getWishlist = profile.getWishlist

export const postWishlist = profile.postWishlist

export const deleteWishlist = profile.deleteWishlist

export const getWallet = profile.getWallet

export const postAddMoney = profile.postAddMoney

export const getReviews = profile.getReviews

//* -----------------------------------------!                                         
//s     Exporting address                    |
//* -----------------------------------------!      

export const getAddress = address.getAddress

export const postAddAddress = address.postAddAddress

export const getEditAddress = address.getEditAddress

export const postEditAddress = address.postEditAddress

export const postDeleteAddress = address.postDeleteAddress

export const getChangePassword = address.getChangePassword

export const postChangePassword = address.postChangePassword


//* -----------------------------------------!                                         
//s           Exporting Cart                 |
//* -----------------------------------------!      

export const getCart = cart.getCart

export const updateQuantity = cart.updateQuantity

export const postAddProductToCart = cart.postAddProductToCart

export const postRemoveItemFromCartHandler = cart.postRemoveItemFromCartHandler

export const postUpdateTotal = cart.postUpdateTotal


//* -----------------------------------------!                                         
//s          Exporting checkout              |
//* -----------------------------------------!


export const getCheckoutPage = checkout.getCheckoutPage

export const postPlaceOrderInCheckout = checkout.postPlaceOrderInCheckout

export const applyCoupon = checkout.applyCoupon

export const createRazorPayOrder = checkout.createRazorPayOrder

export const verifyPayment = checkout.verifyPayment

export const retryPayment = checkout.retryPayment

export const verifyRetryPayment = checkout.verifyRetryPayment

export const orderSuccess = checkout.orderSuccess

export const postWalletPayment = checkout.postWalletPayment

