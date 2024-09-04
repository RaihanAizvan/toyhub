import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nocache from "nocache";
import session from "express-session";
import passport from './utils/passport.js'; // Import your passport configuration
import expressLayouts from "express-ejs-layouts";
// Import routes
import adminRoutes from "./routes/adminRoute.js";
import userRoutes from "./routes/userRoute.js";
import googleRoutes from "./routes/googleAuthRoute.js";
import homeRoutes from "./routes/homeRoute.js";
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
    secret: "abc123",
    saveUninitialized: true,
    cookie: { secure: false },
    resave: true,
  })
);

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "script-src 'self' http://localhost:8001 https://cdn.jsdelivr.net https://unpkg.com 'unsafe-inline';");
  next();
});

app.use(nocache());

// Initialize Passport and restore authentication state, if any, from the session
app.use(passport.initialize());
app.use(passport.session());

// Middleware for parsing JSON data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));



//layouts
app.use(expressLayouts);
app.set('layout','./layouts/layout')

// Set the 'views' directory and view engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const port = process.env.PORT;

// Route middleware
app.use("/", homeRoutes);
app.use("/admin", adminRoutes);
app.use("/user", userRoutes);
app.use("/auth", googleRoutes);

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com");
    next();
});

// Main route for the landing page
app.get("/", landingRoute.getLandingPage);

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
