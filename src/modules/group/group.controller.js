const groupService = require('./groupService');
const { GroupMemberService, MEMBER_ROLES } = require('./groupMemberService');
const { createGroupSchema, updateGroupSchema, addMemberSchema, updateMemberSchema } = require('./group.validator');
const { s3 } = require('../../config/aws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DynamoDB } = require('aws-sdk');

class GroupController {
  /**
   * Get user's groups
   */
  async getUserGroups(req, res) {
    try {
      const userId = req.user.userId; // Lấy userId từ token
      console.log('Getting groups for user:', userId);
      
      const groups = await groupService.getUserGroups(userId);
      console.log('Found groups:', groups.length);
      
      res.json(groups);
    } catch (error) {
      console.error('Error getting user groups:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Create a new group
   */
  async createGroup(req, res) {
    try {
      const { error } = createGroupSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      console.log('Creating group with request body:', req.body); // Debug log

      // Create group with members and name
      const group = await groupService.createGroup({
        members: req.body.members,
        createdBy: req.body.createdBy,
        name: req.body.name // Explicitly pass the name
      });

      // emitEvent(GROUP_EVENTS.CREATED, group);
      res.status(201).json(group);
    } catch (error) {
      console.error('Create group error:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get group by ID
   */
  async getGroup(req, res) {
    try {
      const group = await groupService.getGroupById(req.params.groupId);
      if (!group) {
        return res.status(404).json({ error: 'Group not found' });
      }
      res.json(group);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update group
   */
  async updateGroup(req, res) {
    try {
      const { error } = updateGroupSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const group = await groupService.updateGroup(req.params.groupId, req.body);
      res.json(group);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Delete group (soft delete)
   */
  async deleteGroup(req, res) {
    try {
      const group = await groupService.deleteGroup(req.params.groupId);
      // PHÁT SOCKET.IO
      const io = req.app.get('io');
      if (io) {
        io.to(`group:${req.params.groupId}`).emit('group:dissolved', req.params.groupId);
      }
      res.json({ message: 'Group deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Add member to group
   */
  async addMember(req, res) {
    try {
      const { error } = addMemberSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      // Lấy userId của người thực hiện (người thêm thành viên)
      const addedBy = req.user.userId;

      const member = await GroupMemberService.addMember(
        req.params.groupId,
        req.body.userId,
        req.body.role,
        addedBy // truyền thêm trường addedBy
      );

      // PHÁT SOCKET.IO
      const io = req.app.get('io');
      if (io) {
        const members = await GroupMemberService.getGroupMembers(req.params.groupId);
        io.to(`group:${req.params.groupId}`).emit('group:member_joined', {
          groupId: req.params.groupId,
          members
        });
      }

      res.status(201).json(member);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get group members
   */
  async getMembers(req, res) {
    try {
      const members = await GroupMemberService.getGroupMembers(req.params.groupId);
      res.json(members);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update member role
   */
  async updateMember(req, res) {
    try {
      const { error } = updateMemberSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ error: error.details[0].message });
      }

      const member = await GroupMemberService.updateMember(
        req.params.groupId,
        req.params.memberId,
        req.body
      );

     // emitEvent(GROUP_EVENTS.MEMBER_UPDATED, member);
      // PHÁT SOCKET.IO
      const io = req.app.get('io');
      if (io) {
        const members = await GroupMemberService.getGroupMembers(req.params.groupId);
        io.to(`group:${req.params.groupId}`).emit('group:member_updated', {
          groupId: req.params.groupId,
          members
        });
      }
      res.json(member);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Remove member from group
   */
  async removeMember(req, res) {
    try {
      await GroupMemberService.removeMember(req.params.groupId, req.params.memberId);
  
      const io = req.app.get('io');
      if (io) {
        const members = await GroupMemberService.getGroupMembers(req.params.groupId);
        io.to(`group:${req.params.groupId}`).emit('group:member_removed', {
          groupId: req.params.groupId,
          members
        });
      }
      res.json({ message: 'Member removed successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Update last read timestamp
   */
  async updateLastRead(req, res) {
    try {
      const member = await GroupMemberService.updateLastRead(
        req.params.groupId,
        req.params.memberId,
        req.body.timestamp
      );
      res.json(member);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  // Cập nhật avatar nhóm
  async updateGroupAvatar(req, res) {
    try {
      const { groupId } = req.params;
      const userId = req.user.userId;

      // Log để debug
      console.log('Update group avatar request:', {
        groupId,
        userId,
        file: req.file,
        body: req.body
      });

      if (!req.file) {
        return res.status(400).json({
          status: 'error',
          message: 'Không tìm thấy file avatar'
        });
      }

      // // Kiểm tra quyền (chỉ admin mới được cập nhật)
      // const member = await GroupMemberService.getMember(groupId, userId);
      // if (!member || member.role !== 'ADMIN') {
      //   return res.status(403).json({
      //     status: 'error',
      //     message: 'Bạn không có quyền cập nhật avatar nhóm'
      //   });
      // }

      // Lấy thông tin file
      const file = req.file;
      console.log('Received file:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });

      try {
        // Upload to S3
        const filepath = `groups/avatars/${groupId}_${Date.now()}${path.extname(file.originalname)}`;
        const s3Response = await s3.upload({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: filepath,
          Body: file.buffer,
          ContentType: file.mimetype
        }).promise();

        console.log('S3 upload result:', s3Response);

        // Cập nhật URL avatar trong database
        const updatedGroup = await groupService.updateGroupAvatar(groupId, s3Response.Location);

        // Lưu tin nhắn hệ thống vào bảng group-message
        const dynamoDB = new DynamoDB.DocumentClient();
        const messageId = uuidv4();
        const timestamp = new Date().toISOString();
        const systemMessage = {
          groupMessageId: messageId,
          groupId,
          senderId: userId,
          content: `Ảnh đại diện nhóm đã thay đổi`,
          type: 'system',
          createdAt: timestamp,
          updatedAt: timestamp,
          status: 'sent',
          metadata: { event: 'AVATAR_UPDATED', avatarUrl: s3Response.Location }
        };
        await dynamoDB.put({
          TableName: process.env.GROUP_MESSAGE_TABLE,
          Item: systemMessage
        }).promise();

        // Thông báo cho các thành viên qua socket
        const io = req.app.get('io');
        if (io) {
          io.to(`group:${groupId}`).emit('group:updated', {
            groupId,
            type: 'AVATAR_UPDATED',
            data: { avatarUrl: s3Response.Location }
          });
          io.to(`group:${groupId}`).emit('new-group-message', {
            ...systemMessage
          });
        }

        return res.json({
          status: 'success',
          message: 'Cập nhật avatar nhóm thành công',
          data: {
            avatarUrl: s3Response.Location
          }
        });
      } catch (s3Error) {
        console.error('S3 upload error:', s3Error);
        return res.status(500).json({
          status: 'error',
          message: 'Lỗi khi upload ảnh',
          error: s3Error.message
        });
      }

    } catch (error) {
      console.error('Update group avatar error:', error);
      if (error.response) {
        console.error('Server error details:', {
          status: error.response.status,
          data: error.response.data,
          headers: error.response.headers
        });
      }
      return res.status(500).json({
        status: 'error',
        message: 'Lỗi khi cập nhật avatar nhóm',
        error: error.message
      });
    }
  }

  // Cập nhật tên nhóm
  async updateGroupName(req, res) {
    try {
      const { groupId } = req.params;
      const { name } = req.body;
      const userId = req.user.userId;

      if (!name || !name.trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'Tên nhóm không được để trống'
        });
      }

      // Cập nhật tên nhóm
      const updatedGroup = await groupService.updateGroup(groupId, { name: name.trim() });

      // Lưu tin nhắn hệ thống vào bảng group-message
      const dynamoDB = new DynamoDB.DocumentClient();
      const messageId = uuidv4();
      const timestamp = new Date().toISOString();
      const systemMessage = {
        groupMessageId: messageId,
        groupId,
        senderId: userId,
        content: `Tên nhóm đã đổi thành <b>\"${name.trim()}\"</b>`,
        type: 'system',
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'sent',
        metadata: { event: 'NAME_UPDATED' }
      };
      await dynamoDB.put({
        TableName: process.env.GROUP_MESSAGE_TABLE,
        Item: systemMessage
      }).promise();

      // Thông báo cho các thành viên qua socket
      const io = req.app.get('io');
      if (io) {
        io.to(`group:${groupId}`).emit('group:updated', {
          groupId,
          type: 'NAME_UPDATED',
          data: { name: name.trim() }
        });
        io.to(`group:${groupId}`).emit('new-group-message', {
          ...systemMessage
        });
      }

      return res.json({
        status: 'success',
        message: 'Cập nhật tên nhóm thành công',
        data: { name: name.trim() }
      });
    } catch (error) {
      console.error('Update group name error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Lỗi khi cập nhật tên nhóm',
        error: error.message
      });
    }
  }
}

module.exports = new GroupController(); 