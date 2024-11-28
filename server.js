import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nocache from "nocache";
import session from "express-session";
import passport from './utils/passport.js'; // Import your passport configuration
import expressLayouts from "express-ejs-layouts";
import morgan from 'morgan'
// Import routes
import adminRoutes from "./routes/adminRoute.js";
import userRoutes from "./routes/userRoute.js";
import googleRoutes from "./routes/googleAuthRoute.js";
import homeRoutes from "./routes/homeRoute.js";
import productRoutes from "./routes/productRoute.js"
import profileRoutes from "./routes/profileRoutes.js"
import cartRoutes from "./routes/cartRoute.js"
import checkoutRoutes from "./routes/checkoutRoute.js"
import connectDB from "./models/main.models.js";
import * as landingRoute from "./controllers/userController.js";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// Connect to the database 
connectDB();

// Set up session middleware
app.use(
  session({
    secret: 'yourSecret',
    resave: false,
    saveUninitialized: true,
  })
);

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "script-src 'self' http://localhost:8001 https://cdn.jsdelivr.net https://code.jquery.com https://cdnjs.cloudflare.com https://checkout.razorpay.com 'unsafe-inline';");
  next();
});
app.use((req, res, next) => {
  req.session.sAdminEmail = "admin@gmail.com"
  next(); 
});

app.use((req,res,next )=>{
  req.session.user = {
    id:"66d72a6ea0c029810e11757b",
    name:"Achuu",
  }
  next();
})

app.use(nocache());

// Initialize Passport and restore authentication state, if any, from the session
app.use(passport.initialize());
app.use(passport.session());

// Middleware for parsing JSON data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

app.use(morgan('dev'))

//middlware to Send the Toast Information to the Client: Use a middleware to pass the session data to the EJS template.
app.use((req, res, next) => {
  res.locals.toast = req.session.toast;
  delete req.session.toast;
  next();
});
app.use((req, res, next) => {
  res.locals.flashMessage = req.session.flashMessage;
  delete req.session.flashMessage;
  next();
});
app.use((req, res, next) => {
  res.locals.name = req.session.user?.name
  next();
});


//layouts
app.use(expressLayouts);
app.set('layout', './layouts/layout')

// Set the 'views' directory and view engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const port = process.env.NODE_ENV === 'production' ? process.env.PORT : 3000;

// Route middleware
app.use("/", homeRoutes);
app.use("/admin", adminRoutes);
app.use("/user", userRoutes);
app.use("/auth", googleRoutes);
app.use("/product", productRoutes);
app.use("/account", profileRoutes);
app.use("/cart", cartRoutes);
app.use("/checkout", checkoutRoutes);

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com https://code.jquery.com https://cdnjs.cloudflare.com");
  next();
});

// Main route for the landing page
app.get("/", landingRoute.getLandingPage);

// 404 Handler
app.use((req,res) => {
  res.status(404).render('404'); // Renders the 404.ejs page
});

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
