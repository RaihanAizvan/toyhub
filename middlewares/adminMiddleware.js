import AdminUser from '../models/admin.models.js';
import upload, { IMAGE_FIELDS, describeUploadError } from "../utils/multer.js"
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
  // The fields and their limits are the ones utils/multer.js accepts, so the two
  // cannot drift apart: a form that can send a file is a form the upload will
  // take, and one that cannot is refused rather than stored under a name that
  // nothing reads.
  //
  // A file the upload refuses never reaches the handler, so the request would
  // otherwise end at the page that says nothing is here. It is answered here
  // instead, in the words of the field it belongs to, because a file that is too
  // large or is not an image is a mistake in the picture, not a missing page.
  // A refused upload is answered here rather than by the page that says nothing
  // is there, and the form it sends the person back to is named by the route: the
  // add form for a create, the product's own edit form for an edit, which is why
  // `formPath` may be a function of the request rather than only a string.
  const handleUpload = (formPath = '/admin/addProduct') => (req, res, next) => {
    upload.fields(IMAGE_FIELDS)(req, res, (error) => {
      if (!error) {
        return next();
      }

      console.error('Upload refused:', error.message);
      const message = describeUploadError(error);
      req.session.toast = { message, type: 'error' };

      // The form reads its answer as json, because the cropped pictures are
      // built in the browser; anything else is sent back to the page it came
      // from.
      if (req.xhr === true || String(req.get('accept') ?? '').includes('application/json')) {
        return res.status(400).json({ success: false, errors: { imageError: message } });
      }

      return res.redirect(typeof formPath === 'function' ? formPath(req) : formPath);
    });
  };
  
  export default {
    isAdmin,
    handleUpload,
  } 
  