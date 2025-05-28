const User = require('./userService');
const { s3 } = require('../../config/aws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    QueryCommand,
    GetCommand,
    ScanCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);



// Define updateAvatar function separately
const updateAvatar = async (req, res) => {

    console.log('--- Nhận request upload avatar ---');
    console.log('req.headers:', req.headers);
    console.log('req.body:', req.body);
    console.log('req.file:', req.file);
    try {
        if (!req.file) {
            return res.status(400).json({
                status: 'error',
                message: 'Không tìm thấy file ảnh'
            });
        }

        const { phone } = req.user;

        // Get current user
        const currentUser = await User.getByPhone(phone);
        if (!currentUser) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        // Lấy thông tin file
        const file = req.file;
        console.log('Received file:', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        });

        // Upload to S3
        const filepath = `avatars/${phone}_${Date.now()}${path.extname(file.originalname)}`;
        const s3Response = await s3.upload({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: filepath,
            Body: file.buffer,
            ContentType: file.mimetype,
        }).promise();

        console.log('S3 upload result:', s3Response);

        // Cập nhật avatar mới trong database
        const updatedUser = await User.update(currentUser.userId, {
            avatar: s3Response.Location
        });

        if (!updatedUser) {
            return res.status(500).json({
                status: 'error',
                message: 'Không thể cập nhật avatar'
            });
        }

        // PHÁT SOCKET.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user:${currentUser.userId}`).emit('user:avatar_updated', {
                userId: currentUser.userId,
                avatarUrl: s3Response.Location
            });
        }
        return res.json({
            status: 'success',
            message: 'Cập nhật avatar thành công',
            avatarUrl: s3Response.Location
        });
    } catch (error) {
        console.error('Update avatar error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Lỗi khi cập nhật avatar',
            error: error.message
        });
    }
};

const getProfile = async (req, res) => {
    try {
        const { phone } = req.user;
        const user = await User.getByPhone(phone);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateProfile = async (req, res) => {
    try {
        const { phone } = req.user;
        const updateData = { ...req.body };

        // Get current user
        const currentUser = await User.getByPhone(phone);
        if (!currentUser) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng' });
        }

        // Convert phoneNumber to phone if exists
        if (updateData.phoneNumber) {
            updateData.phone = updateData.phoneNumber;
            delete updateData.phoneNumber;
        }

        // Remove fields that shouldn't be updated
        delete updateData.userId;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        console.log('Updating user with data:', updateData);

        // Use userId for update
        const updatedUser = await User.update(currentUser.userId, updateData);

        if (!updatedUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Convert phone to phoneNumber in response
        const userResponse = {
            ...updatedUser,
            phoneNumber: updatedUser.phone
        };
        delete userResponse.password;
        delete userResponse.phone;

        // PHÁT SOCKET.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user:${currentUser.userId}`).emit('user:profile_updated', {
                userId: currentUser.userId,
                name: updatedUser.name,
                gender: updatedUser.gender,
                dateOfBirth: updatedUser.dateOfBirth,
                phone: updatedUser.phone
            });
        }
        return res.json(userResponse);
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ message: error.message });
    }
};

const searchUsers = async (req, res) => {
    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({ message: 'Search query is required' });
        }

        const users = await User.searchUsers(query);

        // Remove passwords from results
        const usersWithoutPasswords = users.map(user => {
            const { password, ...userWithoutPassword } = user;
            return userWithoutPassword;
        });

        res.json(usersWithoutPasswords);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getUserByPhone = async (req, res) => {
    try {
        const { phone } = req.params;
        const user = await User.getByPhone(phone);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getUserByUserId = async (req, res) => {
    try {
        const userId = req.params?.userId;

        if (!userId) {
            return res.status(400).json({ message: 'User ID is required' });
        }

        // Query using phone-index since that's our primary way to find users
        const params = {
            TableName: "users-zalolite",
            Key: {
                userId: userId
            }
        };

        const { Item: user } = await dynamodb.send(new GetCommand(params));

        if (!user) {
            if (typeof res.json === 'function') {
                return res.status(404).json({ message: 'User not found' });
            }
            return null;
        }

        // Remove sensitive information
        const { password, ...userWithoutPassword } = user;

        // Check if this is an internal call (from other services)
        if (!res || typeof res.json !== 'function') {
            return userWithoutPassword;
        }

        // If it's a regular API call
        res.json(userWithoutPassword);
    } catch (error) {
        console.error('Error getting user by ID:', error);
        if (!res || typeof res.json !== 'function') {
            return null;
        }
        res.status(500).json({ message: error.message });
    }
};

const updateStatus = async (req, res) => {
    try {
        const { phone } = req.user;
        const { status } = req.body;

        if (!status) {
            return res.status(400).json({
                status: 'error',
                message: 'Status is required'
            });
        }

        // Get current user first
        const currentUser = await User.getByPhone(phone);
        if (!currentUser) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Update user status using userId
        const updatedUser = await User.update(currentUser.userId, { status });

        if (!updatedUser) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // PHÁT SOCKET.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user:${currentUser.userId}`).emit('user:status_updated', {
                userId: currentUser.userId,
                status: updatedUser.status
            });
        }
        return res.json({
            status: 'success',
            message: 'Status updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Update status error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Error updating status',
            error: error.message
        });
    }
};

const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const { phone } = req.user;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                status: 'error',
                message: 'Vui lòng cung cấp mật khẩu hiện tại và mật khẩu mới'
            });
        }

        // Get user from database
        const user = await User.getByPhone(phone);
        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'Không tìm thấy người dùng'
            });
        }

        // Verify current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({
                status: 'error',
                message: 'Mật khẩu hiện tại không đúng'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password using userId
        const updatedUser = await User.update(user.userId, { password: hashedPassword });
        if (!updatedUser) {
            return res.status(500).json({
                status: 'error',
                message: 'Không thể cập nhật mật khẩu'
            });
        }

        res.json({
            status: 'success',
            message: 'Đổi mật khẩu thành công'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Lỗi server',
            error: error.message
        });
    }
};

const getUserGroups = async (req, res) => {
    try {
        const { userId } = req.params;

        // Query group members table to get all groups for this user
        const params = {
            TableName: 'group_members-zalolite',
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :userId',
            FilterExpression: 'isActive = :isActive',
            ExpressionAttributeValues: {
                ':userId': userId,
                ':isActive': true
            }
        };

        const result = await dynamodb.send(new QueryCommand(params));

        if (!result.Items || result.Items.length === 0) {
            return res.json({ groups: [] });
        }

        // Get group details for each group
        const groupPromises = result.Items.map(async (member) => {
            const groupParams = {
                TableName: 'groups-zalolite',
                KeyConditionExpression: 'groupId = :groupId',
                ExpressionAttributeValues: {
                    ':groupId': member.groupId
                }
            };

            const groupResult = await dynamodb.send(new QueryCommand(groupParams));
            const group = groupResult.Items?.[0];

            if (group) {
                return {
                    ...group,
                    memberRole: member.role || 'member'
                };
            }
            return null;
        });

        const groups = (await Promise.all(groupPromises)).filter(group => group !== null);

        // Sort groups by lastMessageTime if available
        groups.sort((a, b) => {
            const timeA = a.lastMessageTime || a.createdAt;
            const timeB = b.lastMessageTime || b.createdAt;
            return new Date(timeB) - new Date(timeA);
        });

        res.json({ groups });
    } catch (error) {
        console.error('Error getting user groups:', error);
        res.status(500).json({ message: 'Error getting user groups', error: error.message });
    }
};

const getRecentContacts = async (req, res) => {
    try {
        const { userId, phone } = req.user;

        // Get conversations where user is either participant or otherParticipant
        const params = {
            TableName: 'conversations-zalolite',
            FilterExpression: 'participantId = :phone OR otherParticipantId = :phone',
            ExpressionAttributeValues: {
                ':phone': phone
            }
        };

        const result = await dynamodb.send(new ScanCommand(params));

        // Combine and deduplicate conversations
        const contactPhones = new Set();
        const conversations = result.Items || [];

        conversations.forEach(conv => {
            if (conv.participantId !== phone) {
                contactPhones.add(conv.participantId);
            }
            if (conv.otherParticipantId !== phone) {
                contactPhones.add(conv.otherParticipantId);
            }
        });

        // Get user details for each contact
        const contactPromises = Array.from(contactPhones).map(async (contactPhone) => {
            const userParams = {
                TableName: 'users-zalolite',
                IndexName: 'phone-index',
                KeyConditionExpression: 'phone = :phone',
                ExpressionAttributeValues: {
                    ':phone': contactPhone
                }
            };

            const userResult = await dynamodb.send(new QueryCommand(userParams));
            const user = userResult.Items?.[0];

            if (user) {
                // Remove sensitive information
                const { password, ...safeUser } = user;
                return {
                    userId: safeUser.userId,
                    name: safeUser.name,
                    avatar: safeUser.avatar,
                    phone: safeUser.phone,
                    lastActive: safeUser.lastActive || 'Hoạt động gần đây'
                };
            }
            return null;
        });

        const contacts = (await Promise.all(contactPromises))
            .filter(contact => contact !== null)
            // Sort by lastActive time if available
            .sort((a, b) => {
                const timeA = new Date(a.lastActive);
                const timeB = new Date(b.lastActive);
                return timeB - timeA;
            });

        res.json({
            success: true,
            contacts
        });
    } catch (error) {
        console.error('Error getting recent contacts:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting recent contacts',
            error: error.message
        });
    }
};

// Export individual controller methods
const userController = {
    getProfile,
    updateProfile,
    updateAvatar,
    searchUsers,
    getUserByPhone,
    getUserByUserId,
    updateStatus,
    changePassword,
    getUserGroups,
    getRecentContacts
};



module.exports = userController; 