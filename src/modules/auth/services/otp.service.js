const twilio = require('twilio');
const redis = require('redis');//nơi lưu tạm OTP
const { promisify } = require('util');//Chuyển đổi hàm callback của Redis thành Promise (để dùng async/await).
require('dotenv').config();
//Khởi tạo Twilio client
//Tạo client để gửi tin nhắn SMS với thông tin tài khoản từ .env
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

//Kết nối Redis và tạo các hàm async
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD
});
//Tạo các hàm async cho get, set, del – để dùng Promise thay vì callback
const getAsync = promisify(redisClient.get).bind(redisClient);
const setAsync = promisify(redisClient.set).bind(redisClient);
const delAsync = promisify(redisClient.del).bind(redisClient);

//Tạo một chuỗi số 6 chữ số ngẫu nhiên
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

//Gửi OTP
const sendOTP = async (phoneNumber) => {
  try {
    const otp = generateOTP();
    const expirationTime = parseInt(process.env.OTP_EXPIRATION_MINUTES) * 60; // Convert to seconds

    // Store OTP in Redis with expiration
    await setAsync(
      `otp:${phoneNumber}`,//Lưu mã OTP vào Redis dưới key otp:<số điện thoại>.
      JSON.stringify({
        code: otp,
        attempts: 0,//số lần thử sai (ban đầu là 0).
        createdAt: new Date().toISOString()
      }),
      'EX',
      expirationTime
    );

    // Send OTP via Twilio
    await client.messages.create({//Gửi SMS tới người dùng bằng Twilio API.
      body: `Your verification code is: ${otp}`,
      from: process.env.TWILIO_PHONE_NUMBER,// là số điện thoại đã đăng ký với Twilio.
      to: phoneNumber
    });

    return true;
  } catch (error) {
    console.error('Error sending OTP:', error);
    throw new Error('Failed to send OTP');
  }
};

const verifyOTP = async (phoneNumber, otp) => {
  try {
    const storedData = await getAsync(`otp:${phoneNumber}`);
    if (!storedData) {//Nếu không có dữ liệu → OTP hết hạn hoặc chưa gửi → báo lỗi.
      throw new Error('OTP expired or not found');
    }

    const { code, attempts } = JSON.parse(storedData);//Giải mã JSON từ Redis.
    const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS);

    if (attempts >= maxAttempts) {
      await delAsync(`otp:${phoneNumber}`);
      throw new Error('Maximum attempts reached');
    }

    if (code !== otp) {//Nếu số lần thử sai vượt giới hạn → xóa OTP và báo lỗi.
      // Increment attempts
      const updatedData = JSON.parse(storedData);
      updatedData.attempts += 1;
      await setAsync(
        `otp:${phoneNumber}`,
        JSON.stringify(updatedData),
        'EX',
        parseInt(process.env.OTP_EXPIRATION_MINUTES) * 60
      );
      throw new Error('Invalid OTP');
    }

    // OTP verified successfully, delete it
    //Nếu mã đúng Xóa key OTP khỏi Redis (không cho dùng lại).
    await delAsync(`otp:${phoneNumber}`);
    return true;
  } catch (error) {
    console.error('Error verifying OTP:', error);
    throw error;
  }
};

module.exports = {
  sendOTP,
  verifyOTP
}; 