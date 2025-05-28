#!/bin/bash

# Update system
sudo yum update -y

# Install Docker
sudo amazon-linux-extras install docker -y
sudo service docker start
sudo usermod -a -G docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install 18

# Install PM2 globally
npm install -g pm2

# Clone repository
git clone https://github.com/YOUR_USERNAME/zalo-backend.git
cd zalo-backend

# Install dependencies
npm install

# Build and run Docker container
docker build -t zalo-backend .
docker run -d \
  --name zalo-backend \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  zalo-backend

# Start application with PM2
pm2 start src/index.js --name "zalo-backend"
pm2 startup
pm2 save 