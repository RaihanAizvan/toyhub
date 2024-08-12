import express from "express"

const router = express.Router()

// Define your routes here
router.get("/", (req, res) => {
  res.render("auth/adminLogin")
})

// Export the router as the default export
export default router
