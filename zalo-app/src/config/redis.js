const { createClient } = require('redis');

const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD,
    username: 'default'
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connected to Redis'));

// Hàm kết nối Redis
const connectRedis = async () => {
    try {
        await redisClient.connect();
        console.log('Redis connected successfully');
    } catch (error) {
        console.error('Redis connection error:', error);
    }
};

// Gọi hàm kết nối
connectRedis();

module.exports = redisClient; 