import users from "../../models/users.models.js"
import nodemailer from "nodemailer"
import bcrypt from 'bcrypt';
import validator from "validator"

// function for a timer for try again to sent otp
function tryAgain(){
    setTimeout(() => {
        console.log('Trying again to send OTP...');
        sendMail(otp, req.body.email);
    }, 30000); // 30 second
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'mohammedraihanco@gmail.com',
        pass: 'wegz lokl zrfw dppx ', // password from my app password
    }
});

//function to send mail
async function sendMail(otp, target) {
    const mailOptions = {
        from: 'mohammedraihancogmail.com',
        to: target,
        subject: 'Your OTP for Signup',
        text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
    };
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`Mail sent successfully to ${target} with the otp ${otp}`);
    } catch (error) {
        console.log(error);
    }
}

//! actual controller functions
function getSignup(req, res) {
    res.render('user/signup', { title: 'Signup' })
}


async function postSignup(req, res) {
    // Generate a random 6-digit OTP and define its expiration time
    let otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpires = Date.now() + 5 * 60 * 1000; // OTP expires in 5 minutes

    const { name, email, phone_number, password, confirmPassword } = req.body;
    try {
        // Confirm password match
        if (password !== confirmPassword) {
            return res.status(400).render("user/signup", { 
                title: 'Sign Up', 
                message: "Passwords do not match", 
                name, email, phone_number 
            });
        }

        // Check if the email already exists
        const existingUser = await users.findOne({ email });
        if (existingUser) {
            return res.status(400).render('user/signup', {
                title: 'Sign Up',
                message: 'Email already exists',
                name, email, phone_number
            });
        }

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10); // Salt rounds = 10

        // Create a new user and save it to the database
        const newUser = new users({
            name,
            email,
            phone_number,
            password: hashedPassword, // Save hashed password
            otp, // Store the OTP
            otpExpires, // Store the OTP expiration time
            walletBalance: 0 // Initialize wallet balance using the walletBalance field
        });

        await newUser.save();

        // Send OTP to the user via email
        sendMail(otp, email);

        // Store email in session and redirect to OTP page
        req.session.email = email;
        return res.status(200).redirect('/user/otp');

    } catch (error) {
        console.error(error);
        return res.status(500).render('user/signup', { 
            title: 'Sign Up', 
            message: "Internal Server Error", 
            name, email, phone_number 
        });
    }
}

async function getOtp(req, res) {
    const email = req.session.email;
    try {
        const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).render('user/otp', { message: 'User not found', remainingTime: 0, title: 'OTP Verification' });
        }
        const currentTime = Date.now();
        const remainingTime = Math.max(0, Math.floor((user.otpExpires - currentTime) / 1000)); // Calculate remaining seconds
        res.render('user/otp', { remainingTime, title: 'OTP Verification' });
    } catch (err) {
        console.error(err);
        res.status(500).render('user/otp', { message: 'An error occurred while fetching the user', title: 'OTP Verification' });
    }
}

async function postOtp(req, res) {
    try {
        const { otp1, otp2, otp3, otp4, otp5, otp6 } = req.body;
        const enteredOtp = parseInt(`${otp1}${otp2}${otp3}${otp4}${otp5}${otp6}`);
        const email = req.session.email; 
        const user = await users.findOne({ email }); // Use the email from the session
        // Check if user exists and OTP is valid
        if (user) {
            if (user.otpExpires > Date.now()) {
                if (user.otp === enteredOtp) {
                    await users.updateOne({ email }, { $set: { verified: true } });
                    res.status(200).redirect('/user/login');
                } else {
                    res.status(400).render('user/otp', { message: 'OTP is incorrect', title: 'OTP Verification' });
                }
            } else {
                res.status(404).render('user/otp', { message: 'otp expired', title: 'OTP Verification' });
            }
        } else {
            res.status(404).render('user/otp', { message: 'Internal Server Error Try again ', title: 'OTP Verification' });
        }
        console.log(`Stored OTP: ${user.otp}, Entered OTP: ${enteredOtp}`);
    } catch (error) {
        console.error(error);
        res.status(500).render('user/otp', { message: 'An error occurred while validating OTP', title: 'OTP Verification' });
    }
}


//function for resending otp 

async function postResendOtp(req, res) {
    console.log(1);
    const email = req.session.email;
    if (!email) {
        return res.status(401).redirect("/user/signup");
    }
    try {
        const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).render('user/otp', { message: 'User not found', title: 'Resend OTP' });
        }
        if (user.otpExpires > Date.now()) {
            res.status(400).render('user/otp', { title:'Otp', message: 'OTP is already sent Try again after some time', title: 'Resend OTP' });
        } else {
            let otp = Math.floor(100000 + Math.random() * 900000);
            user.otp = otp;
            user.otpExpires = Date.now() + 1 * 60 * 1000; //! 1 minute
            await user.save();
            sendMail(otp, email);
            console.log('mail send succesfully')
            res.status(200).render('user/otp', {title:'Otp', alertMessage: 'ENter the new OTP', title: 'Resend OTP' });
            tryAgain(); // Try again after 30 seconds
        }
        
    } catch (error) {
        console.error(error);
        res.status(500).render('user/otp', { title:'Otp',message: 'An error occurred while resending OTP', title: 'Resend OTP' });
    }
}
//login

function getLogin(req,res) {       
    const isBlocked = req.query.blocked
    if (req.session.user) {
        return res.redirect("/")
    }
    res.render("user/login",{title:'Login',message:isBlocked?"Sorry You are Blocked" : ""})
}

async function postLogin(req, res) {
    try {
        const { email, password } = req.body;

        // Basic validation for email and password
        if (!email || !password) {
            return res.status(400).render("user/login", { title: 'Login', message: "Email and password are required" });
        }

        // Email validation
        if (!validator.isEmail(email)) {
            return res.status(400).render("user/login", { title: 'Login', message: "Invalid email format" });
        }

        const user = await users.findOne({ email });

        if (!user) {
            return res.status(400).render("user/login", { title: 'Login', message: "Invalid email or password" });
        }

        if (user.isBlocked) {
            return res.status(403).render("user/login", { title: 'Login', message: 'Sorry, you are blocked' });
        }

        // Compare password using bcrypt
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).render("user/login", { title: 'Login', message: "Invalid email or password" });
        }

        // Setting user session
        req.session.user = {
            id: user._id,
            name: user.name
        };

    
        res.redirect("/");

    } catch (err) {
        console.log(err.message);
        res.status(500).render("user/login", { title: 'Login', message: "Internal Server Error", email });
    }
}

async function getLogout(req,res){
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return res.redirect('/'); // Redirect to the homepage or show an error page
            }
    
            // Clear the cookie
            res.clearCookie('connect.sid'); // 'connect.sid' is the default cookie name used by express-session
            
            //clear cache
            res.header('Cache-Control', 'no-cache, no-store, must-revalidate');

            // Redirect to the login page after logout
            res.redirect('/user/login');
        });
    } catch (err) {
        console.log(err.message);
    }
}

function getForgotPassword(req,res){
    res.render("user/forgot-password",{title:"Forgot Password"})
}

async function postForgotPassword(req,res){
    try {
        const {email} = req.body;
        
        // Find user with provided email
        const user = await users.findOne({email});
        
        if(!user) {
            return res.status(404).render("user/forgot-password", {
                title: "Forgot Password",
                message: "No account found with that email address"
            });
        }

        // Generate random OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        
        // Save OTP and expiry time to user document
        user.resetPasswordOtp = otp;
        user.resetPasswordExpires = Date.now() + 10*60*1000; // 10 minutes expiry
        await user.save();

        // Send OTP email
        const mailOptions = {
            to: email,
            subject: 'Password Reset OTP',
            html: `
                <h1>Password Reset</h1>
                <p>You requested a password reset. Here is your OTP:</p>
                <h2>${otp}</h2>
                <p>This OTP will expire in 10 minutes.</p>
                <p>If you did not request this, please ignore this email.</p>
            `
        };

        await sendMail(otp, email);

        res.redirect(`/user/reset-password?email=${email}`);

    } catch(err) {
        console.error(err);
        res.status(500).render("user/forgot-password", {
            title: "Forgot Password", 
            message: "Error sending reset email. Please try again."
        });
    }
}

function getResetPassword(req,res){
    const email = req.query.email || req.body.email;
    res.render("user/resend-otp",{
        title:"Reset Password",
        email
    });
}

async function postResetPassword(req,res){
    try {
        const { otp, newPassword, confirmPassword } = req.body;
        const email = req.query.email || req.body.email;

        // Validate passwords match
        if(newPassword !== confirmPassword) {
            return res.render("user/resend-otp", {
                title: "Reset Password",
                email,
                message: "Passwords do not match"
            });
        }

        // Find user and validate OTP
        const user = await users.findOne({
            email,
            
        });

        console.log(user);

        if(!user) {
            return res.render("user/resend-otp", {
                title: "Reset Password", 
                email,
                message: "Invalid or expired OTP"
            });
        }

        // Update password
        user.password = await bcrypt.hash(newPassword, 10);
        
        await user.save();

        res.redirect("/user/login");

    } catch(err) {
        console.error(err);
        res.status(500).render("user/resend-otp", {
            title: "Reset Password",
            email: req.body.email,
            message: "Error resetting password. Please try again."
        });
    }
}

export default {
    postSignup,
    getSignup,
    getOtp,
    postOtp,
    getLogin,
    postLogin,
    postResendOtp,
    getLogout,
    getForgotPassword,
    postForgotPassword,
    getResetPassword,
    postResetPassword
}