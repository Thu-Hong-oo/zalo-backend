// Tạo mã OTP ngẫu nhiên 6 số
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Kiểm tra OTP có hợp lệ không (6 số)
const isValidOTP = (otp) => {
    return /^\d{6}$/.test(otp);
};

module.exports = {
    generateOTP,
    isValidOTP
}; 