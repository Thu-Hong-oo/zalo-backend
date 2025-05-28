const express = require('express');
const router = express.Router();
const { authController } = require('./controller');

// Public routes
router.post('/register/send-otp', authController.sendRegisterOTP);
router.post('/register/verify-otp', authController.verifyRegisterOTP);
router.post('/register/complete', authController.completeRegistration);
router.post('/login', authController.login);
router.post('/register/resend-otp', authController.resendOTP);
router.post('/refresh-token', authController.refreshToken);
router.post('/forgot-password/send-otp', authController.sendForgotPasswordOTP);
router.post('/forgot-password/verify-otp', authController.verifyForgotPasswordOTP);
router.post('/forgot-password/reset', authController.resetPassword);
// Protected routes - chỉ cần token hợp lệ
router.put('/password', authController.changePassword);

// Protected routes - yêu cầu trạng thái online
router.post('/logout', authController.requireOnlineStatus, authController.logout);

module.exports = router; 