const multer = require('multer');

// Supported MIME types and extensions for product images
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
]);

// Maximum file size in bytes (5 MB per image)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Configure memory storage so files are streamed directly into Supabase Storage
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5 // Max 5 images per request
  },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
      const err = new Error('Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  }
});

module.exports = {
  upload,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE
};
