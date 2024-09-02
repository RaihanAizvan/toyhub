//* Requiring necessary modules
import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import nocache from "nocache"
import session from "express-session"
import adminRoutes from "./routes/adminRoute.js"
import userRoutes from "./routes/userRoute.js"
import homeRoutes from "./routes/homeRoute.js"
import connectDB from "./models/main.models.js"
import * as landingRoute from "./controllers/userController.js"


// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

//  connect to the database 
connectDB();

// Set up session middleware
app.use(
  session({
    secret: "abc123",
    saveUninitialized: true,
    cookie: { secure: false },
    resave: true,
  })
)

app.use(nocache())


// Middleware for parsing JSON data
app.use(express.json())

//middleware to parse URL-encoded data
app.use(express.urlencoded({ extended: true }))

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")))

// Require config files

// Set the 'views' directory and view engine
app.set("views", path.join(__dirname, "views"))
app.set("view engine", "ejs")

// Initialize necessary variables
const port = process.env.PORT

// Route middleware for base routes
app.use("/", homeRoutes)

// Route middleware for admin routes
app.use("/admin", adminRoutes)

// Route middleware for user routes
app.use("/user", userRoutes)

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com");
    next();
});
// Main route for the landing page
app.get("/", landingRoute.getLandingPage)

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`)
})
