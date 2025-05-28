const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const AWS = require('aws-sdk');

// Debug environment variables
console.log('Current directory:', __dirname);
console.log('Environment Variables:');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '***' : 'not set');
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '***' : 'not set');

// Validate required environment variables
const requiredEnvVars = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  process.exit(1);
}

// Cấu hình AWS
const awsConfig = {
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

AWS.config.update(awsConfig);

const dynamodb = new AWS.DynamoDB();

// Định nghĩa cấu trúc bảng users
const createUsersTable = async () => {
  const params = {
    TableName: 'users-zalolite',
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'phone', AttributeType: 'S' },
      { AttributeName: 'name', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'phone-index',
        KeySchema: [
          { AttributeName: 'phone', KeyType: 'HASH' }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      },
      {
        IndexName: 'name-index',
        KeySchema: [
          { AttributeName: 'name', KeyType: 'HASH' }
        ],
        Projection: {
          ProjectionType: 'ALL'
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await dynamodb.createTable(params).promise();
    console.log('Users table created successfully');
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('Users table already exists');
    } else {
      throw error;
    }
  }
};

// Định nghĩa cấu trúc bảng groups
const groupsTableParams = {
  TableName: 'groups-zalolite',
  KeySchema: [
    { AttributeName: 'groupId', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'groupId', AttributeType: 'S' },
    { AttributeName: 'createdBy', AttributeType: 'S' },
    { AttributeName: 'createdAt', AttributeType: 'S' },
    { AttributeName: 'name', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'createdBy-index',
      KeySchema: [
        { AttributeName: 'createdBy', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      IndexName: 'name-index',
      KeySchema: [
        { AttributeName: 'name', KeyType: 'HASH' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

// Định nghĩa cấu trúc bảng group_members
const groupMembersTableParams = {
  TableName: 'group_members-zalolite',
  KeySchema: [
    { AttributeName: 'groupId', KeyType: 'HASH' },
    { AttributeName: 'userId', KeyType: 'RANGE' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'groupId', AttributeType: 'S' },
    { AttributeName: 'userId', AttributeType: 'S' },
    { AttributeName: 'joinedAt', AttributeType: 'S' },
    { AttributeName: 'role', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'userId-index',
      KeySchema: [
        { AttributeName: 'userId', KeyType: 'HASH' },
        { AttributeName: 'joinedAt', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      IndexName: 'role-index',
      KeySchema: [
        { AttributeName: 'groupId', KeyType: 'HASH' },
        { AttributeName: 'role', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

// Định nghĩa cấu trúc bảng messages
const messagesTableParams = {
    TableName: 'messages-zalolite',
    KeySchema: [
        { AttributeName: 'messageId', KeyType: 'HASH' },
        { AttributeName: 'timestamp', KeyType: 'RANGE' }
    ],
    AttributeDefinitions: [
        { AttributeName: 'messageId', AttributeType: 'S' },
        { AttributeName: 'timestamp', AttributeType: 'N' },
        { AttributeName: 'conversationId', AttributeType: 'S' },
        { AttributeName: 'senderPhone', AttributeType: 'S' },
        { AttributeName: 'receiverPhone', AttributeType: 'S' }
    ],
    GlobalSecondaryIndexes: [
        {
            IndexName: 'conversationIndex',
            KeySchema: [
                { AttributeName: 'conversationId', KeyType: 'HASH' },
                { AttributeName: 'timestamp', KeyType: 'RANGE' }
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        },
        {
            IndexName: 'senderIndex',
            KeySchema: [
                { AttributeName: 'senderPhone', KeyType: 'HASH' },
                { AttributeName: 'timestamp', KeyType: 'RANGE' }
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        },
        {
            IndexName: 'receiverIndex',
            KeySchema: [
                { AttributeName: 'receiverPhone', KeyType: 'HASH' },
                { AttributeName: 'timestamp', KeyType: 'RANGE' }
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        }
    ],
    ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
    }
};

// Định nghĩa cấu trúc bảng conversations
const conversationsTableParams = {
    TableName: 'conversations-zalolite',
    KeySchema: [
        { AttributeName: 'conversationId', KeyType: 'HASH' }
    ],
    AttributeDefinitions: [
        { AttributeName: 'conversationId', AttributeType: 'S' },
        { AttributeName: 'participantId', AttributeType: 'S' },
        { AttributeName: 'otherParticipantId', AttributeType: 'S' },
        { AttributeName: 'updatedAt', AttributeType: 'N' }
    ],
    GlobalSecondaryIndexes: [
        {
            IndexName: 'participantIndex',
            KeySchema: [
                { AttributeName: 'participantId', KeyType: 'HASH' },
                { AttributeName: 'updatedAt', KeyType: 'RANGE' }
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        },
        {
            IndexName: 'otherParticipantIndex',
            KeySchema: [
                { AttributeName: 'otherParticipantId', KeyType: 'HASH' },
                { AttributeName: 'updatedAt', KeyType: 'RANGE' }
            ],
            Projection: {
                ProjectionType: 'ALL'
            },
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        }
    ],
    ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
    }
};

// Định nghĩa cấu trúc bảng friends
const friendsTableParams = {
  TableName: 'friends-zalolite',
  KeySchema: [
    { AttributeName: 'userId', KeyType: 'HASH' },
    { AttributeName: 'friendId', KeyType: 'RANGE' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'userId', AttributeType: 'S' },
    { AttributeName: 'friendId', AttributeType: 'S' },
    { AttributeName: 'createdAt', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'friendId-index',
      KeySchema: [
        { AttributeName: 'friendId', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

// Định nghĩa cấu trúc bảng friend requests
const friendRequestsTableParams = {
  TableName: 'friendRequests',
  KeySchema: [
    { AttributeName: 'requestId', KeyType: 'HASH' }
  ],
  AttributeDefinitions: [
    { AttributeName: 'requestId', AttributeType: 'S' },
    { AttributeName: 'from', AttributeType: 'S' },
    { AttributeName: 'to', AttributeType: 'S' },
    { AttributeName: 'createdAt', AttributeType: 'S' }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'from-index',
      KeySchema: [
        { AttributeName: 'from', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      IndexName: 'to-index',
      KeySchema: [
        { AttributeName: 'to', KeyType: 'HASH' },
        { AttributeName: 'createdAt', KeyType: 'RANGE' }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 5,
    WriteCapacityUnits: 5
  }
};

// Hàm tạo bảng
async function createTable(params) {
  try {
    const result = await dynamodb.createTable(params).promise();
    console.log('✅ Tạo bảng thành công:', result.TableDescription.TableName);
  } catch (error) {
    if (error.code === 'ResourceInUseException') {
      console.log('⚠️ Bảng đã tồn tại:', params.TableName);
    } else {
      console.error('❌ Lỗi khi tạo bảng:', params.TableName, error);
    }
  }
}

// Tạo các bảng
async function createTables() {
  console.log('🚀 Bắt đầu tạo bảng...');
  
  await createUsersTable();
  await createTable(groupsTableParams);
  await createTable(groupMembersTableParams);
  await createTable(messagesTableParams);
  await createTable(conversationsTableParams);
  await createTable(friendsTableParams);
  await createTable(friendRequestsTableParams);
  
  console.log('✅ Hoàn thành tạo bảng!');
}

// Chạy script
createTables();
