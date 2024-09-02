import users from "../../models/users.models.js"
import nodemailer from "nodemailer"
import bcrypt from 'bcrypt';

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
    res.render('auth/signup')
}

async function postSignup(req, res) {
    // Generate a random 6-digit OTP and send it to the user's email
    let otp = Math.floor(100000 + Math.random() * 900000);
    const otpExpires = Date.now() + 1 * 60 * 1000; //! 1mints
    
    // setInterval(() => {console.log(`otp expires in ${}`)},1000)
    try {
        const { name, email, password, phone_number } = req.body;

        // Check if the email already exists
        const existingUser = await users.findOne({ email });
        if (existingUser) {
            console.log(` ${existingUser} already exist so failed`);
            return res.status(400).render('auth/signup', {
                message: 'Email already exists',
                name,
                email,
                phone_number,
            });
        }

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

        // Create a new user if the email doesn't exist
        const newUser = new users({
            name,
            email,
            password: hashedPassword, // Use hashed password
            phone_number,
            otp,
            otpExpires, // Store the expiry time of the OTP
        });

        await newUser.save();

        req.session.email = email;
        res.status(200).redirect('/user/otp');
        console.log(`User created successfully and the name is ${newUser.name}`);
        //send mail to the user 
        sendMail(otp, email);
    } catch (error) {
        console.log(error);
        res.status(500).render('auth/signup', { message: "An error occurred while saving the user" });
    }
}

async function getOtp(req, res) {
    const email = req.session.email;
    try {
        const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).render('auth/otp', { message: 'User not found', remainingTime: 0 });
        }

        const currentTime = Date.now();
        const remainingTime = Math.max(0, Math.floor((user.otpExpires - currentTime) / 1000)); // Calculate remaining seconds
        console.log(remainingTime);
        res.render('auth/otp', { remainingTime });
    } catch (err) {
        console.error(err);
        res.status(500).render('auth/otp', { message: 'An error occurred while fetching the user' });
    }
}

async function postOtp(req, res) {
    try {
        const { otp1, otp2, otp3, otp4, otp5, otp6 } = req.body;
        const enteredOtp = parseInt(`${otp1}${otp2}${otp3}${otp4}${otp5}${otp6}`);
        const email = req.session.email;
        console.log(`the email of the user entered is ${email}`);
        const user = await users.findOne({ email }); // Use the email from the session
        console.log(user);
        // Check if user exists and OTP is valid
        if (user) {
            if (user.otpExpires > Date.now()) {
                if (user.otp === enteredOtp) {
                    console.log(`going to chech on '${user.otp}' == '${enteredOtp}'`);
                    await users.updateOne({ email }, { $set: { verified: true } });
                    res.status(200).redirect('user/login');
                } else {
                    res.status(400).render('auth/otp', { message: 'OTP is incorrect' });
                }
            } else {
                res.status(404).render('auth/otp', { message: 'otp expired' });
            }
        } else {
            res.status(404).render('auth/otp', { message: 'User not found' });
        }
        console.log(`Stored OTP: ${user.otp}, Entered OTP: ${enteredOtp}`);
    } catch (error) {
        console.error(error);
        res.status(500).render('auth/otp', { message: 'An error occurred while validating OTP' });
    }
}


//function for resending otp 

async function postResendOtp(req, res) {
    const email = req.session.email;
    if (!email) {
        return res.status(401).redirect("/user/signup");
    }
    try {
        const user = await users.findOne({ email });
        if (!user) {
            return res.status(404).render('auth/otp', { message: 'User not found' });
        }
        if (user.otpExpires > Date.now()) {
            res.status(400).render('auth/otp', { message: 'OTP is already sent Try again after some time' });
        } else {
            let otp = Math.floor(100000 + Math.random() * 900000);
            user.otp = otp;
            user.otpExpires = Date.now() + 4 * 60 * 1000; // 1
            await user.save();
            sendMail(otp, email);
            res.status(200).render('auth/otp', { message: 'OTP sent again' });
            tryAgain(); // Try again after 30 seconds
            console.log(`Resending OTP to ${email}`);
            console.log(`Stored OTP: ${user.otp}, Entered OTP: ${otp}`);
        }
        
    } catch (error) {
        console.error(error);
        res.status(500).render('auth/otp', { message: 'An error occurred while resending OTP' });
    }
}


//login

function getLogin(req,res) {       
    if (req.session.user) {
        return res.redirect("/")
    }
    res.render("auth/login")
}

async function postLogin(req, res) {
    try {
        const { email, password } = req.body;
        const user = await users.findOne({ email, password });
        if (user) {
            req.session.user = user;
            res.redirect("/");
        } else {
            res.status(400).render("auth/login", { message: "Invalid email or password", email: user.email });
        }
    } catch (err) {
        console.log(err.message);
    }
}

export default {
    postSignup,
    getSignup,
    getOtp,
    postOtp,
    getLogin,
    postLogin,
    postResendOtp
}