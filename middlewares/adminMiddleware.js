import upload from "../utils/multer.js"

function isAdmin(req, res, next) {
    if (req.session && req.session.sAdminEmail) {
      next()
      console.log("admin middleware passed")
    } else {
      console.log("middleware failed")
      res.status(403).redirect("/admin/login")
    }
  }
  
  //This is middleware for uploading multiple images which from frontent using fetch api also cropped images
  
  const handleUpload = upload.fields([
    { name: 'files', maxCount: 10 },  // Original files
    { name: 'croppedImage_0', maxCount: 1 },
    { name: 'croppedImage_1', maxCount: 1 },
    { name: 'croppedImage_2', maxCount: 1 },
    { name: 'croppedImage_3', maxCount: 1 },
    { name: 'croppedImage_4', maxCount: 1 },
    // Add more if you expect more than 5 images
  ]);
  
  export default {
    isAdmin,
    handleUpload,
  } 
  