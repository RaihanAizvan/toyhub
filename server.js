//* Requiring necessary modules
import express from "express"
import path from "path"
import adminRoutes from "./routes/admin.js"
import { fileURLToPath } from "url"
import dotenv from "dotenv"

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app = express()

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
app.get("/", (req, res) => {
  res.render("auth/login")
})

// Start the server
app.listen(port, () => {
  console.log(`Server started on port ${port}`)
})
