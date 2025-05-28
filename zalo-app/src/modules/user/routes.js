const express = require("express");
const router = express.Router();
const auth = require("../../middleware/auth");
const userController = require("./controller");

// Debug logs for each middleware
// console.log("=== Debug Middleware ===");
// console.log("1. authMiddleware:", auth);
// console.log("2. userController:", userController);
// console.log("3. updateAvatar method:", userController.updateAvatar);

// Cấu hình multer
const multer = require("multer");
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Chấp nhận các file ảnh
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Chỉ chấp nhận file ảnh!"), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // Giới hạn 5MB
  },
});

// Debug log để kiểm tra multer
const uploadMiddleware = upload.single("avatar");
// console.log("4. uploadMiddleware:", uploadMiddleware);
// console.log("5. upload.single:", upload.single);
// console.log("=== End Debug ===");

// Kiểm tra từng middleware trước khi sử dụng
if (!auth) {
  console.error("authMiddleware is undefined!");
}
if (!uploadMiddleware) {
  console.error("uploadMiddleware is undefined!");
}
if (!userController.updateAvatar) {
  console.error("userController.updateAvatar is undefined!");
}

// User routes
router.get("/profile", auth, userController.getProfile);
router.put("/profile", auth, userController.updateProfile);
router.put("/status", auth, userController.updateStatus);

// Avatar routes
router.post(
  "/avatar",
  auth,
  upload.single("avatar"),
  userController.updateAvatar
);

// Password route
router.put("/password", auth, userController.changePassword);

// Get recent contacts
router.get("/recent-contacts", auth, userController.getRecentContacts);

// Search and user lookup routes
router.get("/search", auth, userController.searchUsers);
router.get("/:phone", auth, userController.getUserByPhone);
router.get("/byId/:userId", auth, userController.getUserByUserId);
router.get("/:userId/groups", auth, userController.getUserGroups);

module.exports = router;
