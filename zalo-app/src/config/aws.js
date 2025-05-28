const AWS = require('aws-sdk');

// Configure AWS
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

// Create DynamoDB client
const dynamoDB = new AWS.DynamoDB.DocumentClient();

// Create S3 client
const s3 = new AWS.S3();
const BUCKETS = {
  MEDIA: 'media-zalolite',
  USERS: 'users-zalolite',

};
const TABLES = {
  USERS: 'users-zalolite',
  GROUPS: 'groups-zalolite',
  GROUP_MEMBERS: 'group_members-zalolite'
};

module.exports = {
  dynamoDB,
  s3,
  AWS,
  BUCKETS,
  TABLES
}; 