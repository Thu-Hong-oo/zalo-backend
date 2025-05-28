const { v4: uuidv4 } = require('uuid');
const {
  PutCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'conversations-zalolite';

// ✅ Tạo cuộc trò chuyện
exports.createConversation = async (req, res) => {
  const { from, to } = req.body;
  const io = req.app.get("socket"); // socket.io instance (phải set trong server.js)

  console.log("📥 Tạo cuộc trò chuyện:", { from, to });

  if (!from || !to || from === to) {
    return res.status(400).json({ success: false, message: "Thiếu thông tin hoặc không thể tự trò chuyện với chính mình" });
  }

  try {
    // Kiểm tra đã tồn tại chưa
    const existing = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "contains(participants, :from) AND contains(participants, :to)",
      ExpressionAttributeValues: {
        ":from": from,
        ":to": to
      }
    }));

    if (existing.Items && existing.Items.length > 0) {
      return res.status(200).json({
        success: true,
        message: "Đã có cuộc trò chuyện",
        conversationId: existing.Items[0].conversationId
      });
    }

    // Tạo mới
    const conversationId = uuidv4();
    const createdAt = new Date().toISOString();

    const newItem = {
      conversationId,
      participants: [from, to],
      createdAt,
    };

    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: newItem
    }));

    // Emit socket event cho hai user
    if (io) {
      io.to(from).emit("new_conversation", newItem);
      io.to(to).emit("new_conversation", newItem);
    }

    res.json({ success: true, message: "Đã tạo cuộc trò chuyện", conversationId });
  } catch (error) {
    console.error("❌ Lỗi tạo conversation:", error);
    res.status(500).json({ success: false, message: "Lỗi máy chủ", error: error.message });
  }
};

// ✅ Lấy tất cả cuộc trò chuyện theo userId
exports.getConversationsByUser = async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, message: "Thiếu userId" });
  }

  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
    }));

    const filtered = result.Items?.filter(item => item.participants.includes(userId)) || [];

    res.json({ success: true, data: filtered });
  } catch (err) {
    console.error("❌ Lỗi lấy danh sách conversation:", err);
    res.status(500).json({ success: false, message: "Lỗi máy chủ", error: err.message });
  }
};