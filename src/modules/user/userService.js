const AWS = require('aws-sdk');
const config = require('../../config/aws');
require('dotenv').config();
const { dynamoDB, TABLES } = require('../../config/aws');
const { v4: uuidv4 } = require('uuid');

// Configure AWS
AWS.config.update({
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
    region: config.awsRegion
});

const dynamoDBClient = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;

class User {
    static async create(userData) {
        const { phone, password, name } = userData;
        
        // Check if user already exists
        const existingUser = await this.getByPhone(phone);
        if (existingUser) {
            throw new Error('Số điện thoại đã được đăng ký');
        }

        const timestamp = new Date().toISOString();
        const userId = uuidv4();

        const params = {
            TableName: TABLES.USERS,
            Item: {
                userId,
                phone,
                password,
                name,
                isPhoneVerified: false,
                status: 'ACTIVE',
                createdAt: timestamp,
                updatedAt: timestamp
            }
        };

        await dynamoDBClient.put(params).promise();
        return params.Item;
    }

    static async getByPhone(phone) {
        const params = {
            TableName: TABLES.USERS,
            IndexName: 'phone-index',
            KeyConditionExpression: 'phone = :phone',
            ExpressionAttributeValues: {
                ':phone': phone
            }
        };

        const result = await dynamoDBClient.query(params).promise();
        return result.Items[0];
    }

    static async getById(userId) {
        const params = {
            TableName: TABLES.USERS,
            Key: { userId }
        };

        const result = await dynamoDBClient.get(params).promise();
        return result.Item;
    }

    static async update(userId, updateData) {
        const timestamp = new Date().toISOString();
        
        const updateExpressions = [];
        const expressionAttributeNames = {};
        const expressionAttributeValues = {};
        
        Object.entries(updateData).forEach(([key, value]) => {
            if (key !== 'userId' && key !== 'phone') { // Prevent updating userId and phone
                updateExpressions.push(`#${key} = :${key}`);
                expressionAttributeNames[`#${key}`] = key;
                expressionAttributeValues[`:${key}`] = value;
            }
        });
        
        // Add updatedAt
        updateExpressions.push('#updatedAt = :updatedAt');
        expressionAttributeNames['#updatedAt'] = 'updatedAt';
        expressionAttributeValues[':updatedAt'] = timestamp;

        const params = {
            TableName: TABLES.USERS,
            Key: { userId },
            UpdateExpression: `SET ${updateExpressions.join(', ')}`,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: 'ALL_NEW'
        };

        const result = await dynamoDBClient.update(params).promise();
        return result.Attributes;
    }

    static async searchUsers(query) {
        const params = {
            TableName: TABLES.USERS,
            IndexName: 'name-index',
            KeyConditionExpression: 'begins_with(#name, :query)',
            ExpressionAttributeNames: {
                '#name': 'name'
            },
            ExpressionAttributeValues: {
                ':query': query
            }
        };

        const result = await dynamoDBClient.query(params).promise();
        return result.Items;
    }

    static async updateLastSeen(userId) {
        const timestamp = new Date().toISOString();
        
        const params = {
            TableName: TABLES.USERS,
            Key: { userId },
            UpdateExpression: 'SET lastSeen = :lastSeen',
            ExpressionAttributeValues: {
                ':lastSeen': timestamp
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await dynamoDBClient.update(params).promise();
        return result.Attributes;
    }

    static async delete(phone, name) {
        try {
            const params = {
                TableName: TABLE_NAME,
                Key: {
                    phone: phone,
                    name: name
                }
            };

            await dynamoDBClient.delete(params).promise();
            return true;
        } catch (error) {
            console.error('Lỗi khi xóa người dùng:', error);
            throw error;
        }
    }

    static async updatePassword(phone, name, hashedPassword) {
        const params = {
            TableName: TABLE_NAME,
            Key: {
                phone: phone,
                name: name
            },
            UpdateExpression: 'set password = :password, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':password': hashedPassword,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };

        try {
            const result = await dynamoDBClient.update(params).promise();
            return result.Attributes;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = User; 