
//? ------------------------------------------------------!                                         
//?                   Importing Modules                   |
//--------------------------------------------------------!

import userAuthentication from "./userModules/auth.js"

//? ------------------------------------------------------!                                      
//?                   Exporting Modules                   |                        
// --------------------------------------------------------

export const postSignup = userAuthentication.postSignup

export const getSignup = userAuthentication.getSignup

export const getOtp =  userAuthentication.getOtp

export const postOtp = userAuthentication.postOtp

export const getLogin = userAuthentication.getLogin

export const postLogin = userAuthentication.postLogin

export const postResentOtp = userAuthentication.postResendOtp

