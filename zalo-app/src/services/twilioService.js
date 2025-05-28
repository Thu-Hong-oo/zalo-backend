const twilio = require('twilio');
const { generateOTP } = require('../utils/otp');
const redisClient = require('../config/redis');

// Khởi tạo Twilio client với thông tin từ biến môi trường
const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Format số điện thoại
const formatPhoneNumber = (phone) => {
    // Xóa tất cả khoảng trắng và dấu +
    phone = phone.replace(/\s+/g, '').replace('+', '');
    
    // Nếu số bắt đầu bằng 0, thay thế bằng 84
    if (phone.startsWith('0')) {
        phone = '84' + phone.substring(1);
    }
    
    // Nếu số chưa có 84 ở đầu, thêm vào
    if (!phone.startsWith('84')) {
        phone = '84' + phone;
    }
    
    return '+' + phone;
};

// Gửi OTP qua SMS
const sendOTP = async (phone) => {
    try {
        // Tạo mã OTP
        const otp = generateOTP();
        
        // Log OTP cho mục đích debug
        console.log('\n=== OTP Information ===');
        console.log('📱 Số điện thoại:', phone);
        console.log('🔑 Mã OTP:', otp);
        console.log('=====================\n');

        // Format số điện thoại
        const formattedPhone = formatPhoneNumber(phone);

        // Lưu OTP vào Redis với thời gian hết hạn 5 phút
        try {
            await redisClient.set(`otp:${phone}`, otp, 'EX', 300);
            console.log('Đã lưu OTP vào Redis');
        } catch (redisError) {
            console.error('Lỗi khi lưu OTP vào Redis:', redisError);
            throw new Error('Lỗi lưu trữ OTP');
        }

        // Gửi SMS qua Twilio
        const message = `[ZaloLite] Ma xac thuc cua ban la: ${otp}\n\nMa co hieu luc trong 5 phut. KHONG chia se ma nay voi bat ky ai.`;
        
        const response = await client.messages.create({
            body: message,
            from: process.env.TWILIO_TRIAL_NUMBER,
            to: formattedPhone
        });

        console.log('Đã gửi SMS thành công. Message SID:', response.sid);
        return true;
    } catch (error) {
        console.error('Lỗi chi tiết khi gửi OTP:', error);
        throw new Error('Gửi OTP thất bại: ' + error.message);
    }
};

// Xác thực OTP
const verifyOTP = async (phone, inputOTP) => {
    try {
        // Lấy OTP từ Redis
        const storedOTP = await redisClient.get(`otp:${phone}`);
        console.log('Stored OTP:', storedOTP, 'Input OTP:', inputOTP);

        if (!storedOTP) {
            console.log('Không tìm thấy OTP trong Redis');
            return false;
        }

        // So sánh OTP
        const isValid = inputOTP === storedOTP;
        console.log('OTP valid:', isValid);

        if (isValid) {
            // Xóa OTP đã sử dụng
            await redisClient.del(`otp:${phone}`);
            console.log('Đã xóa OTP khỏi Redis');
        }

        return isValid;
    } catch (error) {
        console.error('Lỗi khi xác thực OTP:', error);
        throw new Error('Xác thực OTP thất bại');
    }
};

module.exports = {
    sendOTP,
    verifyOTP
}; 