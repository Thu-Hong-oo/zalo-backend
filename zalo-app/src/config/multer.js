const multer = require('multer');

// Cấu hình lưu trữ tạm thời
const storage = multer.memoryStorage();

// Giới hạn kích thước file và kiểu file
const fileFilter = (req, file, cb) => {
  // Chỉ chấp nhận ảnh
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Chỉ chấp nhận file ảnh!'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Giới hạn 5MB
  },
  fileFilter: fileFilter,
});

module.exports = upload; 