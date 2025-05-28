const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/auth');
const controller = require('./controller'); // ✅ dùng đúng file

// Tạo cuộc trò chuyện mới
router.post('/', authMiddleware, controller.createConversation);

// Lấy tất cả cuộc trò chuyện theo userId
router.get('/:userId', authMiddleware, controller.getConversationsByUser);

module.exports = router;
