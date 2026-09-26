import pkg from 'cloudinary';
import { readEnv } from './config.js'
const {v2: cloudinary} = pkg;

cloudinary.config({
  cloud_name: readEnv('CLOUDINARY_CLOUD_NAME'),
  api_key: readEnv('CLOUDINARY_API_KEY'),
  api_secret: readEnv('CLOUDINARY_API_SECRET')
});

export default cloudinary;