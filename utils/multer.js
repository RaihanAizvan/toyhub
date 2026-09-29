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

// What the form is allowed to send, and how much of it.
//
// The field names are the ones the add-product form uses: the picked files under
// `files` and one cropped version per position. A request that sends anything
// else has not come from the form, and is refused rather than stored under a
// name nothing reads.
export const IMAGE_FIELDS = Object.freeze([
  { name: 'files', maxCount: 10 },
  { name: 'croppedImage_0', maxCount: 1 },
  { name: 'croppedImage_1', maxCount: 1 },
  { name: 'croppedImage_2', maxCount: 1 },
  { name: 'croppedImage_3', maxCount: 1 },
  { name: 'croppedImage_4', maxCount: 1 },
]);

// A field name says where a file belongs, not what it is, so the type is
// checked as well. Without this, a file is accepted on the strength of the
// input it arrived in and the image host is left to decide.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const acceptImage = (file, cb) => {
  if (!IMAGE_TYPES.has(file.mimetype)) {
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return cb(new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname));
  }
  return cb(null, true);
};

// Set up multer to handle multiple files
const upload = multer({
  storage: storage,
  limits: {
    // Ten originals and five crops, which is the form's five-image limit twice
    // over, plus the file size a product picture is expected to be.
    fileSize: MAX_IMAGE_BYTES,
    files: 15,
    fields: 30,
  },
  fileFilter: (req, file, cb) => {
    // Accept all files that start with 'croppedImage_' or match 'files'
    if (file.fieldname.startsWith('croppedImage_') || file.fieldname === 'files' || file.fieldname === 'image') {
      acceptImage(file, cb);
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// What a refused upload is called, in the words of the field it belongs to. A
// file that is too large or is not an image is a mistake in the picture, and the
// person who made it is the one who can fix it.
export const describeUploadError = (error) => {
  if (error?.code === 'LIMIT_FILE_SIZE') {
    return 'That file is larger than 5 MB. Choose a smaller image, or one that has been cropped down.';
  }
  if (error?.code === 'LIMIT_FILE_COUNT' || error?.code === 'LIMIT_UNEXPECTED_FILE') {
    return error.code === 'LIMIT_FILE_COUNT'
      ? `Too many files were sent. A product has at most ${IMAGE_FIELDS.length - 1} images.`
      : 'Only jpg, png and webp images can be added as a product picture.';
  }
  if (error?.code === 'LIMIT_FIELD_COUNT' || error?.code === 'LIMIT_FIELD_VALUE') {
    return 'The form sent more than it was given fields for.';
  }
  if (error?.code === 'LIMIT_PART_COUNT') {
    return 'That request was too large to upload.';
  }
  return 'The image could not be uploaded. Choose a jpg, png or webp image under 5 MB.';
};

export default upload;
