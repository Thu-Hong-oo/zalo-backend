const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth");
const { DynamoDB } = require("aws-sdk");
const dynamoDB = new DynamoDB.DocumentClient();
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { uploadToS3 } = require("../media/services");
const { GroupMemberService } = require("../group/groupMemberService");

// Map để lưu trữ các kết nối socket theo số điện thoại
const connectedUsers = new Map();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
});

// Controller functions
const getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { lastEvaluatedKey, limit = 50, before = true, date } = req.query;
    const userId = req.user.userId;

    // Kiểm tra quyền truy cập nhóm
    const member = await GroupMemberService.getMember(groupId, userId);
    if (!member) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không phải là thành viên của nhóm này",
      });
    }

    if (!member.isActive) {
      return res.status(403).json({
        status: "error",
        message: "Bạn đã bị xóa khỏi nhóm này",
      });
    }

    const params = {
      TableName: process.env.GROUP_MESSAGE_TABLE,
      IndexName: "groupIndex",
      KeyConditionExpression: date
        ? "groupId = :groupId AND begins_with(createdAt, :datePrefix)"
        : "groupId = :groupId",
      ExpressionAttributeValues: {
        ":groupId": groupId,
      },
      ScanIndexForward: !before,
      Limit: parseInt(limit),
    };

    // Nếu có tham số date, thêm điều kiện lọc theo ngày
    if (date) {
      params.ExpressionAttributeValues[":datePrefix"] = date; // YYYY-MM-DD
    }

    if (lastEvaluatedKey) {
      try {
        params.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
      } catch (e) {
        console.warn("Invalid lastEvaluatedKey:", e);
      }
    }

    const result = await dynamoDB.query(params).promise();

    // Tạo map để lưu trữ tin nhắn gốc và trạng thái thu hồi
    const messageMap = new Map();
    const deleteMap = new Map();

    // Xử lý từng tin nhắn
    result.Items.forEach((message) => {
      if (message.type === "recall_record") {
        // Nếu là bản ghi thu hồi, cập nhật tin nhắn gốc
        const originalMessageId = message.metadata?.originalMessageId;
        if (originalMessageId) {
          messageMap.set(originalMessageId, {
            ...messageMap.get(originalMessageId),
            isRecalled: true,
            recalledBy: message.senderId,
            recalledAt: message.createdAt,
            content: "Tin nhắn đã bị thu hồi",
          });
        }
      } else if (message.type === "delete_record") {
        // Nếu là bản ghi xóa, lưu vào deleteMap
        const deletedMessageId = message.metadata?.deletedMessageId;
        if (deletedMessageId) {
          deleteMap.set(deletedMessageId, {
            deletedBy: message.senderId,
            deletedAt: message.createdAt,
          });
        }
      } else if (message.type === "text" || message.type === "file" || message.type === "system") {
        // Nếu là tin nhắn gốc hoặc system message
        messageMap.set(message.groupMessageId, {
          ...message,
          isRecalled: false,
        });
      }
    });

    // Lọc tin nhắn đã bị xóa bởi user hiện tại
    const filteredMessages = Array.from(messageMap.values()).filter(
      (message) => {
        const deleteInfo = deleteMap.get(message.groupMessageId);
        return !deleteInfo || deleteInfo.deletedBy !== userId;
      }
    );

    // Group messages by date
    const messagesByDate = {};
    filteredMessages.forEach((message) => {
      const messageDate = new Date(message.createdAt).toLocaleDateString(
        "vi-VN"
      );
      if (!messagesByDate[messageDate]) {
        messagesByDate[messageDate] = [];
      }
      messagesByDate[messageDate].push(message);
    });

    res.json({
      status: "success",
      data: {
        messages: messagesByDate,
        pagination: {
          hasMore: result.LastEvaluatedKey !== undefined,
          total: filteredMessages.length,
          lastEvaluatedKey: result.LastEvaluatedKey
            ? JSON.stringify(result.LastEvaluatedKey)
            : null,
        },
      },
    });
  } catch (error) {
    console.error("Error getting group messages:", error);
    res.status(500).json({
      status: "error",
      message: "Đã xảy ra lỗi khi lấy tin nhắn nhóm",
      error: error.message,
    });
  }
};

// Service functions
const GroupMessageService = {
  async sendMessage(
    groupId,
    senderId,
    content,
    fileUrl = null,
    fileType = null
  ) {
    const member = await GroupMemberService.getMember(groupId, senderId);
    if (!member || !member.isActive) {
      throw new Error("Bạn không có quyền gửi tin nhắn trong nhóm này");
    }

    const messageId = uuidv4();
    const timestamp = new Date().toISOString();
    let messageContent = content || fileUrl;
    let messageType = fileUrl ? "file" : "text";
    const messageData = {
      groupMessageId: messageId,
      groupId,
      senderId,
      content: messageContent,
      type: messageType,
      fileType: fileUrl ? fileType : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "sent",
      metadata: {},
    };

    await dynamoDB
      .put({
        TableName: process.env.GROUP_MESSAGE_TABLE,
        Item: messageData,
      })
      .promise();

    return messageData;
  },

  async recallMessage(groupId, messageId, userId) {
    console.log("Starting recallMessage with params:", {
      groupId,
      messageId,
      userId,
    });

    const member = await GroupMemberService.getMember(groupId, userId);
    if (!member || !member.isActive) {
      throw new Error("Bạn không có quyền thu hồi tin nhắn trong nhóm này");
    }

    // Lấy tin nhắn gốc
    const originalMessage = await getMessageById(messageId, groupId);
    console.log("Original message:", originalMessage);

    if (!originalMessage) {
      throw new Error("Không tìm thấy tin nhắn");
    }

    if (originalMessage.senderId !== userId) {
      throw new Error("Bạn không có quyền thu hồi tin nhắn này");
    }

    const messageAge =
      Date.now() - new Date(originalMessage.createdAt).getTime();
    const MAX_RECALL_TIME = 24 * 60 * 60 * 1000; // 24 h
    if (messageAge > MAX_RECALL_TIME) {
      throw new Error("Không thể thu hồi tin nhắn sau 24 h");
    }

    // Cập nhật trạng thái tin nhắn gốc
    const updateParams = {
      TableName: process.env.GROUP_MESSAGE_TABLE,
      Key: {
        groupMessageId: messageId,
        createdAt: originalMessage.createdAt,
      },
      UpdateExpression: "SET #status = :status, metadata = :metadata",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "recalled",
        ":metadata": {
          ...originalMessage.metadata,
          recalledBy: userId,
          recalledAt: new Date().toISOString(),
        },
      },
    };

    console.log(
      "DynamoDB update params:",
      JSON.stringify(updateParams, null, 2)
    );

    try {
      await dynamoDB.update(updateParams).promise();
      console.log("Successfully updated original message status");
    } catch (error) {
      console.error("Error updating original message:", error);
      console.error("Error details:", {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        statusCode: error.statusCode,
      });
      throw error;
    }

    // Tạo bản ghi thu hồi
    const recallRecordId = uuidv4();
    const timestamp = new Date().toISOString();

    const recallRecord = {
      groupMessageId: recallRecordId,
      createdAt: timestamp,
      groupId,
      senderId: userId,
      content: "Tin nhắn đã bị thu hồi",
      type: "recall_record",
      updatedAt: timestamp,
      status: "recalled",
      metadata: {
        originalMessageId: messageId,
        originalContent: originalMessage.content,
        originalSender: originalMessage.senderId,
        recalledBy: userId,
        recalledAt: timestamp,
      },
    };

    console.log(
      "Creating recall record:",
      JSON.stringify(recallRecord, null, 2)
    );

    // Lưu bản ghi thu hồi
    try {
      await dynamoDB
        .put({
          TableName: process.env.GROUP_MESSAGE_TABLE,
          Item: recallRecord,
        })
        .promise();
      console.log("Successfully created recall record");
    } catch (error) {
      console.error("Error creating recall record:", error);
      throw error;
    }

    return {
      messageId,
      groupId,
      content: "Tin nhắn đã bị thu hồi",
      recalledBy: userId,
      recalledAt: timestamp,
    };
  },

  async deleteMessage(groupId, messageId, userId) {
    const member = await GroupMemberService.getMember(groupId, userId);
    if (!member || !member.isActive) {
      throw new Error("Bạn không có quyền xóa tin nhắn trong nhóm này");
    }

    const originalMessage = await getMessageById(messageId, groupId);
    if (!originalMessage) {
      throw new Error("Không tìm thấy tin nhắn");
    }

    const deleteRecordId = uuidv4();
    const timestamp = new Date().toISOString();

    const deleteRecord = {
      TableName: process.env.GROUP_MESSAGE_TABLE,
      Item: {
        groupMessageId: deleteRecordId,
        groupId,
        senderId: userId,
        content: originalMessage.content,
        type: "delete_record",
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "deleted",
        metadata: {
          deletedMessageId: messageId,
          deletedBy: userId,
          senderName: member.name,
          senderAvatar: member.avatar,
          originalSender: originalMessage.senderId,
          originalType: originalMessage.type,
          originalContent: originalMessage.content,
        },
      },
    };

    await dynamoDB.put(deleteRecord).promise();
    return { deletedMessageId: messageId, deletedBy: userId, originalMessage };
  },

  async forwardMessage(
    sourceMessageId,
    sourceGroupId,
    targetId,
    senderId,
    targetType = "group"
  ) {
    try {
      // Lấy tin nhắn gốc từ nhóm nguồn
      const originalMessage = await getMessageById(
        sourceMessageId,
        sourceGroupId
      );
      if (!originalMessage) {
        throw new Error("Không tìm thấy tin nhắn gốc");
      }

      // Tạo tin nhắn mới
      const newMessageId = uuidv4();
      const timestamp = new Date().toISOString();

      if (targetType === "conversation") {
        // Nếu chuyển tiếp từ nhóm sang cuộc trò chuyện cá nhân
        const newMessage = {
          messageId: newMessageId,
          conversationId: `${senderId}_${targetId}`,
          senderPhone: senderId,
          receiverPhone: targetId,
          content: originalMessage.content,
          type: originalMessage.type,
          fileType: originalMessage.fileType,
          timestamp: Date.now(),
          status: "sent",
          metadata: {
            forwardedFrom: "group",
            originalMessageId: sourceMessageId,
            originalSender: originalMessage.senderId,
            originalContent: originalMessage.content,
            originalGroupId: sourceGroupId,
          },
        };

        // Lưu tin nhắn mới vào bảng MESSAGE_TABLE
        await dynamoDB
          .put({
            TableName: process.env.MESSAGE_TABLE,
            Item: newMessage,
          })
          .promise();

        return newMessage;
      } else {
        // Nếu chuyển tiếp sang nhóm khác
        const newMessage = {
          groupMessageId: newMessageId,
          groupId: targetId,
          senderId: senderId,
          content: originalMessage.content,
          type: originalMessage.type,
          fileType: originalMessage.fileType,
          createdAt: timestamp,
          updatedAt: timestamp,
          status: "sent",
          metadata: {
            forwardedFrom: "group",
            originalMessageId: sourceMessageId,
            originalSender: originalMessage.senderId,
            originalContent: originalMessage.content,
            originalGroupId: sourceGroupId,
          },
        };

        // Lưu tin nhắn mới vào bảng GROUP_MESSAGE_TABLE
        await dynamoDB
          .put({
            TableName: process.env.GROUP_MESSAGE_TABLE,
            Item: newMessage,
          })
          .promise();

        return newMessage;
      }
    } catch (error) {
      console.error("Error forwarding message:", error);
      throw error;
    }
  },
};

// API Controllers
const sendGroupMessage = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { content, fileUrl, fileType } = req.body;
    const senderId = req.user.userId;

    const message = await GroupMessageService.sendMessage(
      groupId,
      senderId,
      content,
      fileUrl,
      fileType
    );

    // Gửi thông báo realtime
    const groupMembers = await GroupMemberService.getGroupMembers(groupId);
    const onlineMembers = groupMembers.filter((member) =>
      connectedUsers.has(member.userId)
    );
    onlineMembers.forEach((member) => {
      const socket = connectedUsers.get(member.userId);
      if (socket) {
        socket.emit("new-group-message", message);
      }
    });

    // Emit conversation-updated cho tất cả thành viên nhóm
    const preview = {
      groupId,
      lastMessage: fileUrl ? `[File] ${fileType || "file"}` : content,
      timestamp: message.createdAt,
      sender: senderId,
      type: fileUrl ? "file" : "text",
      fileType: fileUrl ? fileType : null,
    };
    onlineMembers.forEach((member) => {
      const socket = connectedUsers.get(member.userId);
      if (socket) {
        socket.emit("conversation-updated", preview);
      }
    });

    res.json({ status: "success", data: message });
  } catch (error) {
    console.error("Error sending group message:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Đã xảy ra lỗi khi gửi tin nhắn",
    });
  }
};

const recallGroupMessage = async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user.userId;

    const recalledMessage = await GroupMessageService.recallMessage(
      groupId,
      messageId,
      userId
    );

    // Thông báo cho tất cả thành viên trong group
    const groupMembers = await GroupMemberService.getGroupMembers(groupId);
    const onlineMembers = groupMembers.filter((member) =>
      connectedUsers.has(member.userId)
    );
    onlineMembers.forEach((member) => {
      const socket = connectedUsers.get(member.userId);
      if (socket) {
        socket.emit("group-message-recalled", {
          messageId,
          groupId,
          content: "Tin nhắn đã bị thu hồi",
          recalledBy: userId,
          recalledAt: new Date().toISOString(),
        });
      }
    });

    res.json({
      status: "success",
      message: "Đã thu hồi tin nhắn thành công",
      data: recalledMessage,
    });
  } catch (error) {
    console.error("Error recalling group message:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Đã xảy ra lỗi khi thu hồi tin nhắn",
    });
  }
};

const deleteGroupMessage = async (req, res) => {
  try {
    const { groupId, messageId } = req.params;
    const userId = req.user.userId;

    const result = await GroupMessageService.deleteMessage(
      groupId,
      messageId,
      userId
    );

    res.json({
      status: "success",
      message: "Đã xóa tin nhắn",
      data: result,
    });
  } catch (error) {
    console.error("Error deleting group message:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Đã xảy ra lỗi khi xóa tin nhắn",
    });
  }
};

const forwardGroupMessage = async (req, res) => {
  try {
    const { groupId } = req.params; // groupId của nhóm nguồn
    const { sourceMessageId, targetId, targetType } = req.body;
    const senderId = req.user.userId;

    console.log("Forward message request:", {
      sourceGroupId: groupId,
      targetId,
      targetType,
      senderId,
    });

    // Kiểm tra quyền trong nhóm nguồn
    const sourceMember = await GroupMemberService.getMember(groupId, senderId);
    console.log("Source member check:", sourceMember);

    if (!sourceMember || !sourceMember.isActive) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không có quyền truy cập nhóm nguồn",
      });
    }

    let forwardedMessage;
    if (targetType === "group") {
      // Kiểm tra quyền trong nhóm đích
      const targetMember = await GroupMemberService.getMember(
        targetId,
        senderId
      );
      console.log("Target member check:", targetMember);

      if (!targetMember) {
        return res.status(403).json({
          status: "error",
          message: "Bạn không phải là thành viên của nhóm đích",
        });
      }

      if (!targetMember.isActive) {
        return res.status(403).json({
          status: "error",
          message: "Bạn đã bị xóa khỏi nhóm đích",
        });
      }

      // Chuyển tiếp sang nhóm khác
      forwardedMessage = await GroupMessageService.forwardMessage(
        sourceMessageId,
        groupId,
        targetId,
        senderId,
        targetType
      );

      // Thông báo cho các thành viên trong nhóm đích
      const groupMembers = await GroupMemberService.getGroupMembers(targetId);
      const onlineMembers = groupMembers.filter((member) =>
        connectedUsers.has(member.userId)
      );
      onlineMembers.forEach((member) => {
        const socket = connectedUsers.get(member.userId);
        if (socket) {
          socket.emit("new-group-message", forwardedMessage);
        }
      });
    } else {
      // Chuyển tiếp sang cuộc trò chuyện cá nhân
      forwardedMessage = await GroupMessageService.forwardMessage(
        sourceMessageId,
        groupId,
        targetId,
        senderId,
        targetType
      );

      // Thông báo cho người nhận nếu họ đang online
      const targetSocket = connectedUsers.get(targetId);
      if (targetSocket) {
        targetSocket.emit("new-message", forwardedMessage);
      }
    }

    res.json({
      status: "success",
      message: "Đã chuyển tiếp tin nhắn thành công",
      data: forwardedMessage,
    });
  } catch (error) {
    console.error("Error in forward message route:", error);
    res.status(500).json({
      status: "error",
      message: error.message || "Đã xảy ra lỗi khi chuyển tiếp tin nhắn",
    });
  }
};

const initializeSocket = (io) => {
  // Middleware xác thực
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error("Authentication error"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (error) {
      console.error("Socket authentication error:", error);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    try {
      const userId = socket.user.userId;
      console.log("User connected:", userId);
      connectedUsers.set(userId, socket);

      // Xử lý join group
      socket.on("join-group", async (groupId) => {
        try {
          console.log(`User ${userId} attempting to join group ${groupId}`);
          const member = await GroupMemberService.getMember(groupId, userId);

          if (member && member.isActive) {
            // Join socket room
            socket.join(`group:${groupId}`);
            console.log(`User ${userId} joined socket room group:${groupId}`);

            // Update last read time
            const updateParams = {
              TableName: "group_members-zalolite",
              Key: { groupId, userId },
              UpdateExpression: 'set lastReadAt = :now',
              ExpressionAttributeValues: { ':now': new Date().toISOString() },
            };
            await dynamoDB.update(updateParams).promise();

            // Get unread messages count
            const unreadCount = await getUnreadMessagesCount(userId, groupId, member.lastReadAt);

            // Lấy danh sách tin nhắn cũ
            const params = {
              TableName: process.env.GROUP_MESSAGE_TABLE,
              IndexName: "groupIndex",
              KeyConditionExpression: "groupId = :groupId",
              ExpressionAttributeValues: {
                ":groupId": groupId,
              },
              ScanIndexForward: false,
              Limit: 50,
            };

            const result = await dynamoDB.query(params).promise();
            const messages = result.Items.filter(
              (msg) => msg.type !== "delete_record"
            );

            // Gửi tin nhắn cũ và số tin nhắn chưa đọc cho user vừa join
            socket.emit("group-history", {
              groupId,
              messages,
              unreadCount
            });

            // Thông báo cho các thành viên khác
            io.to(`group:${groupId}`).emit("user-joined", {
              userId,
              groupId,
              metadata: {
                name: member.name,
                avatar: member.avatar,
              },
            });
          } else {
            socket.emit("error", {
              message: "Bạn không có quyền tham gia nhóm này",
            });
          }
        } catch (error) {
          console.error("Error joining group:", error);
          socket.emit("error", {
            message: "Đã xảy ra lỗi khi tham gia nhóm",
          });
        }
      });

      socket.on("send-group-message", async (data) => {
        try {
          const { groupId, content, fileUrl, fileType } = data;
          const message = await GroupMessageService.sendMessage(
            groupId,
            userId,
            content,
            fileUrl,
            fileType
          );

          socket.emit("message-sent", { status: "success", message });
          io.to(`group:${groupId}`).emit("new-group-message", {
            ...message,
            type: "received",
          });
        } catch (error) {
          socket.emit("error", { message: error.message });
        }
      });

      socket.on("recall-group-message", async (data) => {
        try {
          const { groupId, messageId } = data;
          await GroupMessageService.recallMessage(groupId, messageId, userId);

          io.to(`group:${groupId}`).emit("group-message-recalled", {
            messageId,
            groupId,
            content: "Tin nhắn đã bị thu hồi",
            recalledBy: userId,
            recalledAt: new Date().toISOString(),
          });
        } catch (error) {
          socket.emit("error", { message: error.message });
        }
      });

      socket.on("delete-group-message", async (data) => {
        try {
          const { groupId, messageId } = data;
          await GroupMessageService.deleteMessage(groupId, messageId, userId);
        } catch (error) {
          socket.emit("error", { message: error.message });
        }
      });

      socket.on("forward-message", async (data) => {
        try {
          const { sourceMessageId, targetId, targetType } = data;
          const senderId = socket.user.userId;

          let forwardedMessage;
          let targetSocket;

          if (targetType === "group") {
            // Chuyển tiếp sang nhóm
            forwardedMessage = await GroupMessageService.forwardMessage(
              sourceMessageId,
              sourceMessageId,
              targetId,
              senderId,
              "group"
            );

            // Thông báo cho các thành viên trong nhóm
            const groupMembers = await GroupMemberService.getGroupMembers(
              targetId
            );
            groupMembers.forEach((member) => {
              const memberSocket = connectedUsers.get(member.userId);
              if (memberSocket) {
                memberSocket.emit("new-group-message", forwardedMessage);
              }
            });
          } else {
            // Chuyển tiếp sang cuộc trò chuyện cá nhân
            const conversationId = createParticipantId(senderId, targetId);
            const timestamp = new Date().toISOString();

            // Lấy tin nhắn gốc
            const originalMessage = await getMessageById(sourceMessageId, null);

            // Tạo tin nhắn mới
            const newMessage = {
              messageId: uuidv4(),
              conversationId,
              senderPhone: senderId,
              receiverPhone: targetId,
              content: originalMessage.content,
              timestamp: Date.now(),
              status: "sent",
              type: originalMessage.type,
              fileType: originalMessage.fileType,
              metadata: {
                forwardedFrom: "group",
                originalMessageId: sourceMessageId,
                originalSender: originalMessage.senderId,
                originalContent: originalMessage.content,
              },
            };

            // Lưu tin nhắn mới
            await dynamoDB
              .put({
                TableName: process.env.MESSAGE_TABLE,
                Item: newMessage,
              })
              .promise();

            // Cập nhật conversation
            await upsertConversation(senderId, targetId, {
              content: newMessage.content,
              timestamp: newMessage.timestamp,
              senderId: senderId,
            });

            forwardedMessage = newMessage;

            // Thông báo cho người nhận nếu họ đang online
            targetSocket = connectedUsers.get(targetId);
            if (targetSocket) {
              targetSocket.emit("new-message", forwardedMessage);
            }
          }

          // Thông báo cho người gửi
          socket.emit("message-forwarded", {
            status: "success",
            message: forwardedMessage,
          });
        } catch (error) {
          console.error("Error forwarding message:", error);
          socket.emit("error", {
            message: error.message || "Đã xảy ra lỗi khi chuyển tiếp tin nhắn",
          });
        }
      });

      // Xử lý rời group
      socket.on("leave-group", (groupId) => {
        socket.leave(`group:${groupId}`);
        socket.to(`group:${groupId}`).emit("user-left", {
          userId,
          groupId,
        });
      });

      // Xử lý disconnect
      socket.on("disconnect", () => {
        console.log(`User ${userId} disconnected`);
        connectedUsers.delete(userId);
      });
    } catch (error) {
      console.error("Error in socket connection:", error);
      socket.disconnect();
    }
  });
};

// Helper functions
const getMessageById = async (messageId, groupId) => {
  try {
    // Tìm tin nhắn trong bảng group-message
    const params = {
      TableName: process.env.GROUP_MESSAGE_TABLE,
      IndexName: "groupIndex",
      KeyConditionExpression: "groupId = :groupId",
      FilterExpression: "groupMessageId = :messageId",
      ExpressionAttributeValues: {
        ":groupId": groupId,
        ":messageId": messageId,
      },
    };

    const result = await dynamoDB.query(params).promise();
    if (result.Items && result.Items.length > 0) {
      return result.Items[0];
    }
    return null;
  } catch (error) {
    console.error("Error getting message by ID:", error);
    throw error;
  }
};

// Sửa lại hàm lấy tin nhắn đã xóa
const getDeletedMessages = async (userId, groupId) => {
  const params = {
    TableName: process.env.GROUP_MESSAGE_TABLE,
    IndexName: "senderIndex",
    KeyConditionExpression: "senderId = :senderId",
    FilterExpression: "groupId = :groupId",
    ExpressionAttributeValues: {
      ":senderId": userId,
      ":groupId": groupId,
    },
  };

  const result = await dynamoDB.query(params).promise();
  // console.log("Deleted messages query result:", result.Items);

  return result.Items.filter((item) => item.type === "delete_record")
    .map((item) => item.metadata?.deletedMessageId)
    .filter(Boolean);
};

// Helper function to get unread messages count
const getUnreadMessagesCount = async (userId, groupId, lastReadAt) => {
  const params = {
    TableName: process.env.GROUP_MESSAGE_TABLE,
    IndexName: "groupIndex",
    KeyConditionExpression: "groupId = :groupId AND createdAt > :lastReadAt",
    FilterExpression: "senderId <> :userId",
    ExpressionAttributeValues: {
      ":groupId": groupId,
      ":lastReadAt": lastReadAt || "1970-01-01T00:00:00.000Z",
      ":userId": userId
    }
  };

  const result = await dynamoDB.query(params).promise();
  return result.Items.length;
};

// Route to handle file uploads in group
router.post(
  "/:groupId/upload",
  authMiddleware,
  upload.array("files"),
  async (req, res) => {
    try {
      const { groupId } = req.params;
      const userId = req.user.userId;

      // Kiểm tra quyền truy cập nhóm
      const member = await GroupMemberService.getMember(groupId, userId);
      if (!member || !member.isActive) {
        return res.status(403).json({
          status: "error",
          message: "Bạn không có quyền truy cập nhóm này",
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Không có file nào được tải lên",
          code: "NO_FILES",
        });
      }

      // Upload files to S3
      const results = await uploadToS3(req.files);
      
      // Kiểm tra kết quả upload
      if (!results || results.length === 0) {
        return res.status(500).json({
          status: "error",
          message: "Không thể tải lên file",
          code: "UPLOAD_FAILED",
        });
      }

      // Lấy URLs và thông tin files
      const urls = results.map(result => result.Location);
      const files = req.files.map(file => ({
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      }));

      res.json({
        status: "success",
        data: {
          urls,
          files,
        },
      });
    } catch (error) {
      console.error("Upload error:", error);
      if (error.isValid === false) {
        return res.status(400).json({
          status: "error",
          message: error.message,
          code: error.code,
        });
      }
      res.status(500).json({
        status: "error",
        message: "Đã xảy ra lỗi server",
        code: "SERVER_ERROR",
      });
    }
  }
);
// Đánh dấu đã đọc cho chat nhóm
router.post('/:groupId/read', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const groupId = req.params.groupId;

    const updateParams = {
      TableName: "group_members-zalolite",
      Key: { groupId, userId },
      UpdateExpression: 'set lastReadAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    };
    await dynamoDB.update(updateParams).promise();

    res.json({ status: 'success' });
  } catch (error) {
    console.error("Update lastReadAt error:", error);
    res.status(500).json({ status: 'error', message: error.message, stack: error.stack });  }
});

// Routes
router.get("/:groupId/messages", authMiddleware, getGroupMessages);
router.post("/:groupId/messages", authMiddleware, sendGroupMessage);
router.delete(
  "/:groupId/messages/:messageId",
  authMiddleware,
  deleteGroupMessage
);
router.put(
  "/:groupId/messages/:messageId/recall",
  authMiddleware,
  recallGroupMessage
);
router.post("/:groupId/messages/forward", authMiddleware, forwardGroupMessage);

// Add new route to get unread messages count
router.get('/:groupId/unread', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const groupId = req.params.groupId;

    // Get member info to get lastReadAt
    const member = await GroupMemberService.getMember(groupId, userId);
    if (!member) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không phải là thành viên của nhóm này"
      });
    }

    const unreadCount = await getUnreadMessagesCount(userId, groupId, member.lastReadAt);

    res.json({
      status: "success",
      data: {
        unreadCount
      }
    });
  } catch (error) {
    console.error("Get unread messages error:", error);
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

// Export both router and socket initialization
module.exports = {
  routes: router,
  socket: initializeSocket,
};
