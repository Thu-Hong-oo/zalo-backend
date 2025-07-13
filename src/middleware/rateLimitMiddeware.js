const { redisClient } = require('../config/redis');

const rateLimitMiddleware = (limitSeconds = 60) => {
  return async (req, res, next) => {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    try {
      const key = `rate_limit:${phoneNumber}`;
      const lastSent = await redisClient.get(key);
      
      if (lastSent) {
        const timeLeft = await redisClient.ttl(key);
        return res.status(429).json({
          success: false,
          message: `Vui lòng đợi ${timeLeft}s trước khi gửi lại`,
          timeLeft
        });
      }

      // Set rate limit
      await redisClient.setex(key, limitSeconds, Date.now().toString());
      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };
};

module.exports = rateLimitMiddleware;