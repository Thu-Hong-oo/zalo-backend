const express = require("express");
const router = express.Router();
const authMiddleware = require("../../middleware/auth");
const { DynamoDB } = require("aws-sdk");
const dynamoDB = new DynamoDB.DocumentClient();
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { uploadToS3 } = require("../media/services");

// Map để lưu trữ các kết nối socket theo số điện thoại
const connectedUsers = new Map();

// Configure multer for file upload
const upload = multer({
  storage: multer.memoryStorage(),
});

// Helper function để tạo participantId
const createParticipantId = (phone1, phone2) => {
  return [phone1, phone2].sort().join("_");
};

// Controller functions
const getConversations = async (req, res) => {
  try {
    const userPhone = req.user.phone;
    console.log("Getting conversations for user phone:", userPhone);
    const { lastEvaluatedKey, limit = 20 } = req.query;

    const mainParams = {
      TableName: process.env.CONVERSATION_TABLE,
      FilterExpression: "participantId = :phone",
      ExpressionAttributeValues: {
        ":phone": userPhone,
      },
      Limit: parseInt(limit),
    };

    if (lastEvaluatedKey) {
      try {
        mainParams.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
      } catch (e) {
        console.warn("Invalid lastEvaluatedKey:", e);
      }
    }

    const otherParams = {
      TableName: process.env.CONVERSATION_TABLE,
      FilterExpression: "otherParticipantId = :phone",
      ExpressionAttributeValues: {
        ":phone": userPhone,
      },
      Limit: parseInt(limit),
    };

    if (lastEvaluatedKey) {
      try {
        otherParams.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
      } catch (e) {
        console.warn("Invalid lastEvaluatedKey:", e);
      }
    }

    const mainResult = await dynamoDB.scan(mainParams).promise();
    const otherResult = await dynamoDB.scan(otherParams).promise();

    const conversationMap = new Map();
    mainResult.Items.forEach((item) =>
      conversationMap.set(item.conversationId, item)
    );
    otherResult.Items.forEach((item) => {
      if (!conversationMap.has(item.conversationId)) {
        conversationMap.set(item.conversationId, item);
      }
    });

    let conversations = Array.from(conversationMap.values());
    conversations.sort((a, b) => b.updatedAt - a.updatedAt);

    const formattedConversations = conversations.map((conv) => ({
      conversationId: conv.conversationId,
      participant: {
        phone: conv.participantId,
        isCurrentUser: conv.participantId === userPhone,
      },
      otherParticipant: {
        phone: conv.otherParticipantId,
        isCurrentUser: conv.otherParticipantId === userPhone,
      },
      lastMessage: {
        content: conv.lastMessage.content,
        senderId: conv.lastMessage.senderId,
        timestamp: conv.lastMessage.timestamp,
        isFromMe: conv.lastMessage.senderId === userPhone,
      },
      timestamps: {
        created: conv.createdAt,
        updated: conv.updatedAt,
      },
    }));

    const hasMoreMain = !!mainResult.LastEvaluatedKey;
    const hasMoreOther = !!otherResult.LastEvaluatedKey;
    const hasMore = hasMoreMain || hasMoreOther;

    const nextLastEvaluatedKey = hasMore
      ? {
          main: mainResult.LastEvaluatedKey,
          other: otherResult.LastEvaluatedKey,
        }
      : null;

    res.json({
      status: "success",
      data: {
        conversations: formattedConversations,
        pagination: {
          total: formattedConversations.length,
          hasMore,
          lastEvaluatedKey: nextLastEvaluatedKey
            ? JSON.stringify(nextLastEvaluatedKey)
            : null,
          currentPage: lastEvaluatedKey
            ? parseInt(JSON.parse(lastEvaluatedKey).page || 1) + 1
            : 1,
          limit: parseInt(limit),
        },
      },
      debug: {
        userPhone,
        mainConversationsFound: mainResult.Items.length,
        otherConversationsFound: otherResult.Items.length,
        totalUnique: formattedConversations.length,
        hasMoreMain,
        hasMoreOther,
        mainLastKey: mainResult.LastEvaluatedKey,
        otherLastKey: otherResult.LastEvaluatedKey,
      },
    });
  } catch (error) {
    console.error("Error getting conversations:", error);
    res.status(500).json({
      status: "error",
      message: "Đã xảy ra lỗi khi lấy danh sách cuộc trò chuyện",
      error: error.message,
      debug: { userPhone: req.user.phone, errorStack: error.stack },
    });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const { phone } = req.params;
    const currentUserPhone = req.user.phone;
    const conversationId = createParticipantId(currentUserPhone, phone);
    const { date, limit = 50, before = true } = req.query;

    // Base query params
    const params = {
      TableName: process.env.MESSAGE_TABLE,
      IndexName: "conversationIndex",
      KeyConditionExpression: "conversationId = :conversationId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
      },
      ScanIndexForward: !before, // true for ascending (older first), false for descending (newer first)
      Limit: parseInt(limit),
    };

    // If date is provided, add timestamp condition
    if (date) {
      const timestamp = new Date(date).getTime();
      if (before) {
        // Get messages before this date
        params.KeyConditionExpression += " AND timestamp < :timestamp";
        params.ExpressionAttributeValues[":timestamp"] = timestamp;
      } else {
        // Get messages after this date
        params.KeyConditionExpression += " AND timestamp > :timestamp";
        params.ExpressionAttributeValues[":timestamp"] = timestamp;
      }
    }

    const result = await dynamoDB.query(params).promise();

    // Group messages by date
    const messagesByDate = {};
    result.Items.forEach((message) => {
      const messageDate = new Date(message.timestamp).toLocaleDateString(
        "vi-VN"
      );
      if (!messagesByDate[messageDate]) {
        messagesByDate[messageDate] = [];
      }
      messagesByDate[messageDate].push(message);
    });

    // Get the oldest and newest timestamps from the results
    let oldestMessage = null;
    let newestMessage = null;
    if (result.Items.length > 0) {
      const sortedMessages = [...result.Items].sort(
        (a, b) => a.timestamp - b.timestamp
      );
      oldestMessage = sortedMessages[0];
      newestMessage = sortedMessages[sortedMessages.length - 1];
    }

    // Format response
    res.json({
      status: "success",
      data: {
        messages: messagesByDate,
        pagination: {
          hasMore: result.LastEvaluatedKey !== undefined,
          total: result.Items.length,
          oldestTimestamp: oldestMessage?.timestamp,
          newestTimestamp: newestMessage?.timestamp,
          nextDate: result.LastEvaluatedKey
            ? new Date(result.LastEvaluatedKey.timestamp).toISOString()
            : null,
        },
      },
    });
  } catch (error) {
    console.error("Error getting chat history:", error);
    res.status(500).json({
      status: "error",
      message: "Đã xảy ra lỗi khi lấy lịch sử chat",
      error: error.message,
    });
  }
};

const upsertConversation = async (senderPhone, receiverPhone, lastMessage) => {
  try {
    // Kiểm tra đầy đủ thông tin trước khi tạo conversation
    if (!senderPhone || !receiverPhone) {
      console.error('upsertConversation thiếu senderPhone hoặc receiverPhone', { senderPhone, receiverPhone });
      return null;
    }

    const conversationId = createParticipantId(senderPhone, receiverPhone);
    const timestamp = Date.now();

    const getParams = {
      TableName: process.env.CONVERSATION_TABLE,
      Key: { conversationId },
    };

    const existingConversation = await dynamoDB.get(getParams).promise();

    const params = {
      TableName: process.env.CONVERSATION_TABLE,
      Item: {
        conversationId,
        participantId: senderPhone,
        otherParticipantId: receiverPhone,
        lastMessage: {
          content: lastMessage.content,
          timestamp: lastMessage.timestamp,
          senderId: lastMessage.senderId,
        },
        updatedAt: timestamp,
        timestamp: timestamp,
        createdAt: existingConversation.Item
          ? existingConversation.Item.createdAt
          : timestamp,
      },
    };

    await dynamoDB.put(params).promise();

    const reverseParams = {
      TableName: process.env.CONVERSATION_TABLE,
      Item: {
        conversationId,
        participantId: receiverPhone,
        otherParticipantId: senderPhone,
        lastMessage: {
          content: lastMessage.content,
          timestamp: lastMessage.timestamp,
          senderId: lastMessage.senderId,
        },
        updatedAt: timestamp,
        timestamp: timestamp,
        createdAt: params.Item.createdAt,
      },
    };

    await dynamoDB.put(reverseParams).promise();
    return params.Item;
  } catch (error) {
    console.error("Error in upsertConversation:", error);
    throw error;
  }
};

const initializeSocket = (io) => {
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
      const userPhone = socket.user.phone;
      console.log("User connected:", userPhone);

      connectedUsers.set(userPhone, socket);
      socket.broadcast.emit("user-online", { phone: userPhone });

      socket.on("send-message", async (data) => {
        try {
          const { receiverPhone, content, fileUrl, fileType, tempId } = data;
          if (!receiverPhone || (!content && !fileUrl)) {
            socket.emit("error", {
              message: "Thiếu thông tin người nhận hoặc nội dung tin nhắn",
              tempId,
            });
            return;
          }

          if (content && content.length > 200) {
            socket.emit("error", {
              message: "Tin nhắn quá dài",
              tempId,
            });
            return;
          }

          const messageId = uuidv4();
          const timestamp = Date.now();
          const conversationId = createParticipantId(userPhone, receiverPhone);

          let messageContent = content || fileUrl;
          let messageType = fileUrl ? "file" : "text";

          const messageParams = {
            TableName: process.env.MESSAGE_TABLE,
            Item: {
              messageId,
              conversationId,
              senderPhone: userPhone,
              receiverPhone,
              content: messageContent,
              timestamp,
              status: "sent",
              type: messageType,
              fileType: fileUrl ? fileType : null,
            },
          };

          await dynamoDB.put(messageParams).promise();

          await upsertConversation(userPhone, receiverPhone, {
            content: fileUrl ? `[File] ${fileType || "file"}` : content,
            timestamp,
            senderId: userPhone,
          });

          const receiverSocket = connectedUsers.get(receiverPhone);
          if (receiverSocket) {
            receiverSocket.emit("new-message", {
              messageId,
              conversationId,
              senderPhone: userPhone,
              content: messageContent,
              timestamp,
              status: "delivered",
              type: messageType,
              fileType: fileUrl ? fileType : null,
            });
          }

          // Send confirmation back to sender with both messageId and tempId
          socket.emit("message-sent", {
            messageId,
            tempId,
            timestamp,
            status: "sent",
          });

          // Emit conversation-updated cho cả người gửi và người nhận
          const preview = {
            conversationId,
            lastMessage: fileUrl ? `[File] ${fileType || "file"}` : content,
            timestamp,
            sender: userPhone,
            type: messageType,
            fileType: fileUrl ? fileType : null,
          };
          socket.emit("conversation-updated", preview);
          if (receiverSocket) {
            receiverSocket.emit("conversation-updated", preview);
          }

          console.log("Message sent successfully:", {
            messageId,
            tempId,
            timestamp,
            status: "sent",
          });
        } catch (error) {
          console.error("Error in send-message:", error);
          socket.emit("error", {
            message: "Lỗi khi gửi tin nhắn",
            tempId: data.tempId,
          });
        }
      });

      socket.on("typing", (data) => {
        const { receiverPhone } = data;
        if (!receiverPhone) return;
        const receiverSocket = connectedUsers.get(receiverPhone);
        if (receiverSocket)
          receiverSocket.emit("typing", { senderPhone: userPhone });
      });

      socket.on("stop-typing", (data) => {
        const { receiverPhone } = data;
        if (!receiverPhone) return;
        const receiverSocket = connectedUsers.get(receiverPhone);
        if (receiverSocket)
          receiverSocket.emit("stop-typing", { senderPhone: userPhone });
      });

      socket.on("disconnect", () => {
        connectedUsers.delete(userPhone);
        socket.broadcast.emit("user-offline", { phone: userPhone });
      });

      socket.on("error", (error) => console.error("Socket error:", error));
    } catch (error) {
      console.error("Error in socket connection:", error);
      socket.disconnect();
    }
  });
};

const recallMessage = async (req, res) => {
  try {
    const { messageId, receiverPhone } = req.body;
    const senderPhone = req.user.phone;
    const conversationId = createParticipantId(senderPhone, receiverPhone);

    const queryParams = {
      TableName: process.env.MESSAGE_TABLE,
      IndexName: "conversationIndex",
      KeyConditionExpression: "conversationId = :conversationId",
      FilterExpression: "messageId = :messageId",
      ExpressionAttributeValues: {
        ":conversationId": conversationId,
        ":messageId": messageId,
      },
    };

    const messages = await dynamoDB.query(queryParams).promise();
    if (!messages.Items || messages.Items.length === 0) {
      return res
        .status(404)
        .json({ status: "error", message: "Không tìm thấy tin nhắn" });
    }

    const message = messages.Items[0];
    if (message.senderPhone !== senderPhone) {
      return res.status(403).json({
        status: "error",
        message: "Bạn không có quyền thu hồi tin nhắn này",
      });
    }

    // Check if message is too old to recall (e.g., older than 2 minutes)
    const messageAge = Date.now() - message.timestamp;
    const MAX_RECALL_TIME = 24 * 60 * 60 * 1000; // 2 minutes in milliseconds

    if (messageAge > MAX_RECALL_TIME) {
      return res.status(400).json({
        status: "error",
        message: "Không thể thu hồi tin nhắn sau 24h",
      });
    }

    const updateParams = {
      TableName: process.env.MESSAGE_TABLE,
      Key: { messageId: messageId, timestamp: message.timestamp },
      UpdateExpression: "set #status = :status, content = :content",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "recalled",
        ":content": "Tin nhắn đã bị thu hồi",
      },
      ReturnValues: "ALL_NEW",
    };

    const result = await dynamoDB.update(updateParams).promise();

    // Format conversation content based on message type
    let recallContent = "Tin nhắn đã bị thu hồi";
    if (message.type === "file") {
      recallContent = `[File] ${message.fileType || "file"} đã bị thu hồi`;
    }

    await upsertConversation(senderPhone, receiverPhone, {
      content: recallContent,
      timestamp: Date.now(),
      senderId: senderPhone,
    });

    const receiverSocket = connectedUsers.get(receiverPhone);
    if (receiverSocket) {
      receiverSocket.emit("message-recalled", {
        messageId,
        conversationId,
        content: recallContent,
        type: message.type,
        fileType: message.fileType,
      });
    }

    res.json({
      status: "success",
      message: "Đã thu hồi tin nhắn thành công",
      data: result.Attributes,
    });
  } catch (error) {
    console.error("Error recalling message:", error);
    res.status(500).json({
      status: "error",
      message: "Không thể thu hồi tin nhắn sau 2 phút",
      error: error.message,
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.body;
    const userPhone = req.user.phone;

    const queryParams = {
      TableName: process.env.MESSAGE_TABLE,
      IndexName: "conversationIndex",
      FilterExpression: "messageId = :messageId",
      ExpressionAttributeValues: { ":messageId": messageId },
    };

    const messages = await dynamoDB.scan(queryParams).promise();
    if (!messages.Items || messages.Items.length === 0) {
      return res
        .status(404)
        .json({ status: "error", message: "Không tìm thấy tin nhắn" });
    }

    const message = messages.Items[0];
    if (message.senderPhone !== userPhone) {
      return res
        .status(403)
        .json({ status: "error", message: "Không có quyền xóa tin nhắn này" });
    }

    const updateParams = {
      TableName: process.env.MESSAGE_TABLE,
      Key: { messageId: messageId, timestamp: message.timestamp },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "deleted" },
    };

    await dynamoDB.update(updateParams).promise();

    // Format conversation content based on message type
    let deleteContent = "Tin nhắn đã bị xóa";
    if (message.type === "file") {
      deleteContent = `[File] ${message.fileType || "file"} đã bị xóa`;
    }

    // Update conversation with the deleted message info
    await upsertConversation(userPhone, message.receiverPhone, {
      content: deleteContent,
      timestamp: Date.now(),
      senderId: userPhone,
    });

    const receiverSocket = connectedUsers.get(message.receiverPhone);
    if (receiverSocket) {
      receiverSocket.emit("message-deleted", {
        messageId,
        conversationId: message.conversationId,
        type: message.type,
        fileType: message.fileType,
      });
    }

    res.json({ status: "success", message: "Đã xóa tin nhắn" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ status: "error", message: "Lỗi khi xóa tin nhắn" });
  }
};

const forwardMessage = async (req, res) => {
  try {
    const { messageId, receiverPhone, content } = req.body;
    const senderPhone = req.user.phone;

    const queryParams = {
      TableName: process.env.MESSAGE_TABLE,
      IndexName: "conversationIndex",
      FilterExpression: "messageId = :messageId",
      ExpressionAttributeValues: { ":messageId": messageId },
    };

    const messages = await dynamoDB.scan(queryParams).promise();
    if (!messages.Items || messages.Items.length === 0) {
      return res
        .status(404)
        .json({ status: "error", message: "Không tìm thấy tin nhắn gốc" });
    }

    const originalMessage = messages.Items[0];
    const newMessageId = uuidv4();
    const conversationId = createParticipantId(senderPhone, receiverPhone);
    const timestamp = Date.now();

    // Handle file forwarding
    let messageContent = content || originalMessage.content;
    let messageType = originalMessage.type || "text";
    let fileType = null;

    // If the original message is a file, preserve the file information
    if (originalMessage.type === "file") {
      messageContent = originalMessage.content; // Use the original file URL
      messageType = "file";
      fileType = originalMessage.fileType;
    }

    const newMessage = {
      messageId: newMessageId,
      timestamp: timestamp,
      conversationId,
      content: messageContent,
      senderPhone,
      receiverPhone,
      status: "sent",
      type: messageType,
      fileType: fileType,
      originalMessageId: messageId,
    };

    await dynamoDB
      .put({ TableName: process.env.MESSAGE_TABLE, Item: newMessage })
      .promise();

    // Update conversation with appropriate content based on message type
    const conversationContent =
      messageType === "file" ? `[File] ${fileType || "file"}` : messageContent;

    await upsertConversation(senderPhone, receiverPhone, {
      content: conversationContent,
      senderId: senderPhone,
      timestamp,
    });

    const receiverSocket = connectedUsers.get(receiverPhone);
    if (receiverSocket) receiverSocket.emit("new-message", newMessage);

    res.json({ status: "success", data: { message: newMessage } });
  } catch (error) {
    console.error("Error forwarding message:", error);
    res.status(500).json({
      status: "error",
      message: "Lỗi khi chuyển tiếp tin nhắn",
      error: error.message,
    });
  }
};

// Route to handle file uploads
router.post(
  "/upload",
  authMiddleware,
  upload.array("files"),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          status: "error",
          message: "Không có file nào được tải lên",
          code: "NO_FILES",
        });
      }

      const results = await uploadToS3(req.files);
      const urls = results.map((result) => result.Location);

      res.json({
        status: "success",
        data: {
          urls,
          files: req.files.map((file) => ({
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
          })),
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
// Đánh dấu đã đọc cho chat cá nhân
router.post('/read/:phone', authMiddleware, async (req, res) => {
  try {
    const currentUserPhone = req.user.phone;
    const otherPhone = req.params.phone;
    const conversationId = createParticipantId(currentUserPhone, otherPhone);

    // Cập nhật unreadCount về 0 cho currentUserPhone trong conversation
    const updateParams = {
      TableName: process.env.CONVERSATION_TABLE,
      Key: { conversationId, participantId: currentUserPhone },
      UpdateExpression: 'set unreadCount = :zero',
      ExpressionAttributeValues: { ':zero': 0 },
    };
    await dynamoDB.update(updateParams).promise();

    res.json({ status: 'success' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Đăng ký routes
router.get("/conversations", authMiddleware, getConversations);
router.get("/history/:phone", authMiddleware, getChatHistory);
router.put("/messages/recall", authMiddleware, recallMessage);
router.delete("/messages/delete", authMiddleware, deleteMessage);
router.post("/messages/forward", authMiddleware, forwardMessage);

// Hàm gửi thông báo cuộc gọi
const sendCallMessage = async ({ conversationId, senderPhone, receiverPhone, status, duration, type, callId }) => {
  try {
    // Kiểm tra đầy đủ thông tin trước khi tạo message
    if (!senderPhone || !receiverPhone) {
      console.error('sendCallMessage thiếu senderPhone hoặc receiverPhone', { senderPhone, receiverPhone });
      return null;
    }

    // Đảm bảo conversationId được tạo đúng từ 2 số điện thoại
    const correctConversationId = [senderPhone, receiverPhone].sort().join('_');
    if (conversationId !== correctConversationId) {
      console.warn('sendCallMessage: conversationId không khớp với senderPhone và receiverPhone', {
        provided: conversationId,
        correct: correctConversationId
      });
      conversationId = correctConversationId;
    }

    const timestamp = Date.now();
    let content = '';
    
    switch (status) {
      case 'started':
        content = 'Bắt đầu cuộc gọi video';
        break;
      case 'ended':
        content = `Kết thúc cuộc gọi video${duration ? ` (${duration}s)` : ''}`;
        break;
      case 'missed':
        content = 'Cuộc gọi nhỡ';
        break;
      case 'declined':
        content = 'Cuộc gọi bị từ chối';
        break;
      default:
        content = `Cuộc gọi video đã bị hủy`;
    }

    const messageId = uuidv4();
    const messageParams = {
      TableName: process.env.MESSAGE_TABLE,
      Item: {
        messageId,
        conversationId,
        senderPhone,
        receiverPhone,
        content,
        timestamp,
        status: 'sent',
        type: type || 'call',
        callStatus: status,
        duration: duration || 0,
        callId
      }
    };

    // Nếu là message call, chỉ cho phép tạo 1 bản ghi với cùng conversationId, callId, callStatus
    if (callId && status) {
      // Check duplicate trước khi tạo
      const existingCheck = await dynamoDB.query({
        TableName: process.env.MESSAGE_TABLE,
        IndexName: 'conversationIndex',
        KeyConditionExpression: 'conversationId = :cid',
        FilterExpression: 'callId = :callId AND callStatus = :status',
        ExpressionAttributeValues: {
          ':cid': conversationId,
          ':callId': callId,
          ':status': status
        }
      }).promise();
      if (existingCheck.Items.length > 0) {
        console.log('Duplicate call message prevented');
        return null;
      }
      try {
        await dynamoDB.put({
          TableName: process.env.MESSAGE_TABLE,
          Item: messageParams.Item || messageParams,
          ConditionExpression: 'attribute_not_exists(callId) AND attribute_not_exists(callStatus)'
        }).promise();
      } catch (err) {
        if (err.code === 'ConditionalCheckFailedException') {
          console.log('Duplicate call message prevented by DynamoDB condition');
          return null;
        }
        throw err;
      }
    } else {
      await dynamoDB.put({
        TableName: process.env.MESSAGE_TABLE,
        Item: messageParams.Item || messageParams
      }).promise();
    }

    // Cập nhật conversation
    await upsertConversation(senderPhone, receiverPhone, {
      content,
      timestamp,
      senderId: senderPhone
    });

    // Gửi thông báo qua socket nếu người nhận hoặc người gửi đang online
    const receiverSocket = connectedUsers.get(receiverPhone);
    if (receiverSocket) {
      receiverSocket.emit('new-message', {
        messageId,
        conversationId,
        senderPhone,
        content,
        timestamp,
        status: 'delivered',
        type: type || 'call',
        callStatus: status,
        duration: duration || 0,
        callId
      });
    }
    // Gửi cho cả sender nếu online (và không trùng receiver)
    const senderSocket = connectedUsers.get(senderPhone);
    if (senderSocket && senderPhone !== receiverPhone) {
      senderSocket.emit('new-message', {
        messageId,
        conversationId,
        senderPhone,
        content,
        timestamp,
        status: 'delivered',
        type: type || 'call',
        callStatus: status,
        duration: duration || 0,
        callId
      });
    }

    return messageId;
  } catch (error) {
    console.error('Error sending call message:', error);
    throw error;
  }
};

// Export
module.exports = {
  routes: router,
  socket: initializeSocket,
  connectedUsers,
  sendCallMessage  // Export hàm sendCallMessage
};