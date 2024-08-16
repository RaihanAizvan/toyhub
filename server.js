//* Requiring necessary modules
import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import session from "express-session"

// relative paths
import adminRoutes from "./routes/adminRoute.js"
import isUser from "./middlewares/userMiddleware.js"

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

// Set up session middleware
app.use(
  session({
    secret: "abc123",
    saveUninitialized: true,
    cookie: { secure: false },
    resave: true,
  })
)

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

// Middleware for parsing JSON data
app.use(express.json())

// Initialize necessary variables
const port = process.env.PORT

// Route middleware for admin routes
app.use("/admin", adminRoutes)

// Main route for the landing page
app.get("/", isUser, (req, res) => {
  if (req.session.user) {
    res.render("")
  }
  res.render("auth/login")
})

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`)
})
