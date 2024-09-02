
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

//* -----------------------------------------!                                         
//s       Exporting landingPage              |
//* -----------------------------------------!      

export const getLandingPage = landingPage.getLandingPage

//* -----------------------------------------!                                         
//s     Exporting singleproductPage          |
//* -----------------------------------------!      


export const getSingleProduct = singleProduct.getSingleProduct

