
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

//* -----------------------------------------!                                         
//s     Exporting singleproductPage          |
//* -----------------------------------------!      


export const getSingleProduct = singleProduct.getSingleProduct

export const viewAllCategories = category.viewAllCategories


//* -----------------------------------------!                                         
//s     Exporting profiles                   |
//* -----------------------------------------!      

export const getProfileEdit = profile.getProfileEdit

export const postUpdateName = profile.postUpdateName

export const postUpdatePhone = profile.postUpdatePhone

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
