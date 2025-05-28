const { uploadToS3, FILE_TYPE_MATCH } = require('./services');

const uploadMultipleMedia = async (req) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            throw new Error("Không có file nào để upload");
        }
        
        const results = await uploadToS3(files);
        const urls = results.map(result => result.Location);
        
        return {
            status: "success",
            data: {
                urls,
                files: files.map(file => ({
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size
                }))
            }
        };
        
    } catch (error) {
        console.error("Upload error:", error);
        throw error;
    }
};

module.exports = { uploadMultipleMedia }; 