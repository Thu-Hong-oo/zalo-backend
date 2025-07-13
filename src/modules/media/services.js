const { s3, BUCKETS } = require('../../config/aws');
const path = require('path');

const MAX_FILE_SIZE = 10*1024 * 1024; 
const MAX_TOTAL_SIZE = 10*1024 * 1024;
const FILE_TYPE_MATCH = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "video/mp3",
    "video/mp4",
    "application/pdf",
    "application/msword",
    "application/vnd.ms-powerpoint",
    "application/vnd.rar",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/x-compressed",
    "application/x-rar-compressed",
    "application/vnd.ms-excel"
];

const validateFile = (file) => {
    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    // Kiểm tra loại file
    if (FILE_TYPE_MATCH.indexOf(file.mimetype) === -1) {
        return {
            isValid: false,
            message: `Không hỗ trợ file có đuôi ${fileExtension}`,
            code: "INVALID_FILE_TYPE"
        };
    }
    
    // Kiểm tra kích thước file
    if (file.size > MAX_FILE_SIZE) {
        return {
            isValid: false,
            message: `File "${file.originalname}" vượt quá giới hạn 10MB (hiện tại: ${(totalSize/(1024*1024)).toFixed(2)})`,
            code: "FILE_TOO_LARGE"
        };
    }
    
    return {
        isValid: true,
        message: 'File hợp lệ'
    };
};

const uploadSingleFile = (file) => {
    const validation = validateFile(file);
    if (!validation.isValid) {
        const error = new Error(validation.message);
        error.code = validation.code;
        throw error;
    }

    // Tạo key duy nhất
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const fileExtension = path.extname(file.originalname);
    const fileNameWithoutExt = path.basename(file.originalname, fileExtension);
    const key = `${fileNameWithoutExt}_${timestamp}_${randomStr}${fileExtension}`;

    const params = {
        Bucket: BUCKETS.MEDIA,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read'
    };

    return s3.upload(params).promise();
};

const uploadToS3 = async (files, conversationId) => {
    // Validate tất cả files trước khi upload
    if (!Array.isArray(files)) {
        const validation = validateFile(files);
        if (!validation.isValid) {
            throw validation; // Throw trực tiếp object validation
        }
        return [await uploadSingleFile(files)];
    }
    // Kiểm tra số lượng file
    if (files.length > 5) {
        throw {
            isValid: false,
            message: `Chỉ được tải tối đa 5 file. Hiện tại đang gửi ${files.length} file.`,
            code: "MAX_FILE_COUNT_EXCEEDED"
        };
    }
   
    // Kiểm tra tổng kích thước
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
        throw {
            isValid: false,
            message: `Tổng dung lượng vượt quá 10MB. Hiện tại là ${(totalSize/(1024*1024)).toFixed(2)} MB`,
            code: "TOTAL_SIZE_EXCEEDED"
        };
    }
    
    // Validate từng file
    for (const file of files) {
        const validation = validateFile(file);
        if (!validation.isValid) {
            throw validation; // Throw trực tiếp object validation
        }
    }
    
    try {
        // Upload tất cả files
        const results = await Promise.all(files.map(file => uploadSingleFile(file)));
        return results;
    } catch (error) {
        // Nếu là lỗi từ S3
        throw {
            isValid: false,
            message: "Lỗi khi tải file lên S3",
            code: "S3_UPLOAD_ERROR",
            originalError: error
        };
    }
};

module.exports = { uploadToS3, FILE_TYPE_MATCH }; 
