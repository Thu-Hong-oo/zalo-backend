const AWS = require('aws-sdk');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const awsConfig = {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  };
  
  AWS.config.update(awsConfig);
  
  const dynamodb = new AWS.DynamoDB();

const params = {
  TableName: 'videoCall-zaloLite',
  AttributeDefinitions: [
    { AttributeName: 'callId', AttributeType: 'S' }
  ],
  KeySchema: [
    { AttributeName: 'callId', KeyType: 'HASH' }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

dynamodb.createTable(params, (err, data) => {
  if (err) console.error('Unable to create table:', err);
  else console.log('Created table:', data);
});