import AdminUser from '../models/admin.models.js';
import upload from "../utils/multer.js"
import { clearSessionCookie } from "../utils/session.js"
import { isAdminAccount } from "../controllers/adminModules/login.js"

const rejectAdminRequest = (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      clearSessionCookie(res);
      res.status(403).redirect("/admin/login");
    });
    return;
  }
  res.status(403).redirect("/admin/login");
}

// Re-checks the account behind the session on every admin request, so a
// deactivated, deleted or demoted administrator loses access immediately.
async function isAdmin(req, res, next) {
    const email = req.session?.sAdminEmail;
    if (!email) {
      return rejectAdminRequest(req, res);
    }

    try {
      const admin = await AdminUser.findOne({ email });
      if (!isAdminAccount(admin)) {
        return rejectAdminRequest(req, res);
      }
      req.admin = admin;
      next();
    } catch (error) {
      console.error('Admin authorization failed:', error.message);
      res.status(500).json({ message: 'Server error' });
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
  