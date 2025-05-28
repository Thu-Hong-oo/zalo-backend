# Use Node.js LTS version
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port (thay đổi port này theo ứng dụng của bạn)
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 