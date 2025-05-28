const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Joi = require('joi');//Xác thực dữ liệu đầu vào
const User = require('../user/userService');
const twilioService = require('../../services/twilioService');
require('dotenv').config();

// Helper function to format phone number
const formatPhoneNumber = (phone) => {
    // Remove any non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // If phone starts with 0, remove it and add 84
    if (cleaned.startsWith('0')) {
        return '84' + cleaned.substring(1);
    }
    
    // If phone doesn't start with 84, add it
    if (!cleaned.startsWith('84')) {
        return '84' + cleaned;
    }
    
    return cleaned;
};

// Token generation function
const generateTokens = (user) => {
    if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
        throw new Error('JWT secrets are not configured');
    }

    const accessToken = jwt.sign(
        { 
            userId: user.userId,
            phone: user.phone 
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );
    
    const refreshToken = jwt.sign(
        { 
            userId: user.userId,
            phone: user.phone 
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRATION || '7d' }
    );
    
    return { accessToken, refreshToken };
};

// Validation schemas
const sendOTPSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Số điện thoại không hợp lệ',
        'any.required': 'Vui lòng nhập số điện thoại'
    })
});

const verifyOTPSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Số điện thoại không hợp lệ',
        'any.required': 'Vui lòng nhập số điện thoại'
    }),
    otp: Joi.string().required().length(6).messages({
        'string.length': 'Mã OTP phải có 6 chữ số',
        'any.required': 'Vui lòng nhập mã OTP'
    })
});

const registerSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Số điện thoại không hợp lệ',
        'any.required': 'Vui lòng nhập số điện thoại'
    }),
    name: Joi.string().required().min(2).max(50).messages({
        'string.min': 'Tên phải có ít nhất 2 ký tự',
        'string.max': 'Tên không được vượt quá 50 ký tự',
        'any.required': 'Vui lòng nhập tên'
    }),
    password: Joi.string().required().min(6).messages({
        'string.min': 'Mật khẩu phải có ít nhất 6 ký tự',
        'any.required': 'Vui lòng nhập mật khẩu'
    })
});

const loginSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Phone number must be valid',
        'any.required': 'Phone number is required'
    }),
    password: Joi.string().required().messages({
        'any.required': 'Password is required'
    })
});

const refreshTokenSchema = Joi.object({
    refreshToken: Joi.string().required().messages({
        'any.required': 'Refresh token is required'
    })
});

const forgotPasswordSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Số điện thoại không hợp lệ',
        'any.required': 'Vui lòng nhập số điện thoại'
    })
});

const resetPasswordSchema = Joi.object({
    phone: Joi.string().required().pattern(/^\+?[0-9]{10,15}$/).messages({
        'string.pattern.base': 'Số điện thoại không hợp lệ',
        'any.required': 'Vui lòng nhập số điện thoại'
    }),
    newPassword: Joi.string().required().min(6).messages({
        'string.min': 'Mật khẩu phải có ít nhất 6 ký tự',
        'any.required': 'Vui lòng nhập mật khẩu mới'
    })
});

const changePasswordSchema = Joi.object({
    currentPassword: Joi.string().required().messages({
        'any.required': 'Vui lòng nhập mật khẩu hiện tại'
    }),
    newPassword: Joi.string()
        .required()
        .min(6)
        .messages({
            'string.min': 'Mật khẩu mới phải có ít nhất 6 ký tự',
            'any.required': 'Vui lòng nhập mật khẩu mới'
        })
});

// Send OTP for registration
const sendRegisterOTP = async (req, res) => {
    try {
        const { error } = sendOTPSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Check if phone number already exists
        const existingUser = await User.getByPhone(formattedPhone);
        if (existingUser) {
            return res.status(409).json({ message: 'Số điện thoại đã được đăng ký' });
        }

        // Send OTP using twilioService
        await twilioService.sendOTP(formattedPhone);

        res.status(200).json({ message: 'Đã gửi mã OTP thành công' });
    } catch (error) {
        console.error('Lỗi khi gửi OTP:', error);
        res.status(500).json({ message: 'Gửi mã OTP thất bại' });
    }
};

// Verify OTP for registration
const verifyRegisterOTP = async (req, res) => {
    try {
        const { error } = verifyOTPSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone, otp } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Verify OTP using twilioService
        const isValid = await twilioService.verifyOTP(formattedPhone, otp);
        if (!isValid) {
            return res.status(400).json({ message: 'Mã OTP không hợp lệ' });
        }

        res.status(200).json({ message: 'Xác thực mã OTP thành công' });
    } catch (error) {
        console.error('Lỗi khi xác thực OTP:', error);
        res.status(500).json({ message: 'Xác thực mã OTP thất bại' });
    }
};

// Complete registration
const completeRegistration = async (req, res) => {
    try {
        const { error } = registerSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone, name, password } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Check if phone number already exists
        const existingUser = await User.getByPhone(formattedPhone);
        if (existingUser) {
            return res.status(409).json({ message: 'Số điện thoại đã được đăng ký' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user
        const user = await User.create({
            phone: formattedPhone,
            name,
            password: hashedPassword,
            isPhoneVerified: true
        });

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user);

        res.status(201).json({
            message: 'Đăng ký thành công',
            accessToken,
            refreshToken,
            user: {
                userId: user.userId,
                phone: user.phone,
                name: user.name
            }
        });
    } catch (error) {
        console.error('Lỗi khi hoàn tất đăng ký:', error);
        res.status(500).json({ message: 'Hoàn tất đăng ký thất bại' });
    }
};

// Login
const login = async (req, res) => {
    try {
        // Validate input
        const { error } = loginSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone, password } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Get user by phone
        const user = await User.getByPhone(formattedPhone);
        if (!user) {
            return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng' });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ message: 'Số điện thoại hoặc mật khẩu không đúng' });
        }

        // Update user status to online
        await User.update(user.userId, { status: 'online' });

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Remove password from user object
        const { password: _, ...userWithoutPassword } = user;

        res.json({
            message: 'Đăng nhập thành công',
            accessToken,
            refreshToken,

            user: {
                userId: user.userId,
                phone: user.phone,
                name: user.name,
                status: 'online'
            }

        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Đăng nhập thất bại', error: error.message });
    }
};

// Resend OTP
const resendOTP = async (req, res) => {
    try {
        const { error } = sendOTPSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Send OTP using twilioService
        await twilioService.sendOTP(formattedPhone);

        res.status(200).json({ message: 'Đã gửi lại mã OTP thành công' });
    } catch (error) {
        console.error('Lỗi khi gửi lại OTP:', error);
        res.status(500).json({ message: 'Gửi lại mã OTP thất bại' });
    }
};

// Refresh token
const refreshToken = async (req, res) => {
    try {
        // Validate input
        const { error } = refreshTokenSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { refreshToken: token } = req.body;

        // Verify refresh token
        const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
        const { phone, userId } = decoded;

        // Get user from database
        const user = await User.getByPhone(phone);
        if (!user) {
            return res.status(401).json({ message: 'User not found' });
        }

        // Generate new tokens
        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

        res.json({
            message: 'Token refreshed successfully',
            accessToken,
            refreshToken: newRefreshToken
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid refresh token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Refresh token expired' });
        }
        console.error('Refresh token error:', error);
        res.status(500).json({ message: 'Token refresh failed' });
    }
};

// Logout
const logout = async (req, res) => {
    try {
        // Get user phone from token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }

        try {
            // Try to decode token even if it's expired
            const decoded = jwt.decode(token);
            if (!decoded || !decoded.phone) {
                return res.status(401).json({ message: 'Token không hợp lệ' });
            }

            // Get user info
            const user = await User.getByPhone(decoded.phone);
            if (!user) {
                return res.status(404).json({ message: 'Không tìm thấy người dùng' });
            }

            // Update user status to offline
            await User.update(decoded.phone, {
                name: user.name,
                status: 'offline'
            });

            res.status(200).json({ message: 'Đăng xuất thành công' });
        } catch (tokenError) {
            console.error('Lỗi khi xử lý token:', tokenError);
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }
    } catch (error) {
        console.error('Lỗi khi đăng xuất:', error);
        res.status(500).json({ message: 'Đăng xuất thất bại' });
    }
};

// Send OTP for forgot password
const sendForgotPasswordOTP = async (req, res) => {
    try {
        const { error } = forgotPasswordSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Check if user exists
        const user = await User.getByPhone(formattedPhone);
        if (!user) {
            return res.status(404).json({ message: 'Số điện thoại chưa được đăng ký' });
        }

        // Send OTP using twilioService
        await twilioService.sendOTP(formattedPhone);

        res.status(200).json({ message: 'Đã gửi mã OTP thành công' });
    } catch (error) {
        console.error('Lỗi khi gửi OTP:', error);
        res.status(500).json({ message: 'Gửi mã OTP thất bại' });
    }
};

// Verify OTP for forgot password
const verifyForgotPasswordOTP = async (req, res) => {
    try {
        const { error } = verifyOTPSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { phone, otp } = req.body;
        const formattedPhone = formatPhoneNumber(phone);

        // Check if user exists
        const user = await User.getByPhone(formattedPhone);
        if (!user) {
            return res.status(404).json({ message: 'Số điện thoại chưa được đăng ký' });
        }

        // Verify OTP
        const isValid = await twilioService.verifyOTP(formattedPhone, otp);
        if (!isValid) {
            return res.status(400).json({ message: 'Mã OTP không hợp lệ' });
        }

        // Generate temporary token for password reset
        const resetToken = jwt.sign(
            { phone: formattedPhone },
            process.env.JWT_SECRET,
            { expiresIn: '5m' }
        );

        res.status(200).json({
            message: 'Xác thực mã OTP thành công',
            resetToken
        });
    } catch (error) {
        console.error('Lỗi khi xác thực OTP:', error);
        res.status(500).json({ message: 'Xác thực OTP thất bại' });
    }
};

// Reset password
const resetPassword = async (req, res) => {
    try {
        // Verify reset token
        const resetToken = req.headers.authorization?.split(' ')[1];
        if (!resetToken) {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }

        const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
        const { phone } = decoded;

        const { error } = resetPasswordSchema.validate({ ...req.body, phone });
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        // Get user
        const user = await User.getByPhone(phone);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);

        // Update password
        await User.update(phone, {
            name: user.name,
            password: hashedPassword
        });

        res.status(200).json({ message: 'Đặt lại mật khẩu thành công' });
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token đã hết hạn' });
        }
        console.error('Lỗi khi đặt lại mật khẩu:', error);
        res.status(500).json({ message: 'Đặt lại mật khẩu thất bại' });
    }
};

// Middleware to check if user is online
const requireOnlineStatus = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { phone } = decoded;

        const user = await User.getByPhone(phone);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        if (user.status !== 'online') {
            return res.status(403).json({ message: 'Bạn cần đăng nhập để thực hiện chức năng này' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token đã hết hạn' });
        }
        console.error('Lỗi khi kiểm tra trạng thái:', error);
        res.status(500).json({ message: 'Lỗi hệ thống' });
    }
};

// Change password - không yêu cầu trạng thái online//vì có thể thay đổi lúc đăng nhập
const changePassword = async (req, res) => {
    try {
        const { error } = changePasswordSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const { currentPassword, newPassword } = req.body;

        // Get user phone from token
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token không hợp lệ' });
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const { phone } = decoded;

            // Get user
            const user = await User.getByPhone(phone);
            if (!user) {
                return res.status(404).json({ message: 'Không tìm thấy người dùng' });
            }

            // Verify current password
            const isValidPassword = await bcrypt.compare(currentPassword, user.password);
            if (!isValidPassword) {
                return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
            }

            // Check if new password is same as current password
            const isSamePassword = await bcrypt.compare(newPassword, user.password);
            if (isSamePassword) {
                return res.status(400).json({ message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại' });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password - giữ nguyên trạng thái hiện tại
            await User.update(phone, {
                name: user.name,
                password: hashedPassword,
                status: user.status // Giữ nguyên trạng thái
            });

            res.status(200).json({ message: 'Đổi mật khẩu thành công' });
        } catch (tokenError) {
            if (tokenError.name === 'JsonWebTokenError') {
                return res.status(401).json({ message: 'Token không hợp lệ' });
            }
            if (tokenError.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token đã hết hạn' });
            }
            throw tokenError;
        }
    } catch (error) {
        console.error('Lỗi khi đổi mật khẩu:', error);
        res.status(500).json({ message: 'Đổi mật khẩu thất bại' });
    }
};

const authController = {
    sendRegisterOTP,
    verifyRegisterOTP,
    completeRegistration,
    login,
    resendOTP,
    refreshToken,
    logout,
    sendForgotPasswordOTP,
    verifyForgotPasswordOTP,
    resetPassword,
    changePassword,
    requireOnlineStatus
};

module.exports = { authController }; 