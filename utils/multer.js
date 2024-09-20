import multer from 'multer'
import { CloudinaryStorage}  from 'multer-storage-cloudinary'
import cloudinary from './cloudinary.js'; 

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'uploads',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});


  
  // Set up multer to handle multiple files
  const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
      // Accept all files that start with 'croppedImage_' or match 'files'
      if (file.fieldname.startsWith('croppedImage_') || file.fieldname === 'files' || file.fieldname ==='image') {
        cb(null, true);
      } else {
        cb(new Error('Unexpected field'));
      }
    }
  });


export default upload;