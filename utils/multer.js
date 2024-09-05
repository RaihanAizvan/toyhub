import multer from 'multer'
import { CloudinaryStorage}  from 'multer-storage-cloudinary'
import cloudinary from './cloudinary.js'; 

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
      folder: 'uploads',
      allowed_formats: ['jpg', 'png','jpeg', 'webp'],
    },
  });
  
  // Set up multer to handle multiple files
  const upload = multer({ storage: storage });

export default upload;