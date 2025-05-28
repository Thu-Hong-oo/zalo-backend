const { v4: uuidv4 } = require("uuid");
const {
  PutCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(client);

const TABLE_NAME = "friendRequests";
const USERS_TABLE = "users-zalolite";
const FRIENDS_TABLE = "friends-zalolite";

async function getUserProfile(userId) {
  try {
    const params = {
      TableName: USERS_TABLE,
      Key: { userId },
    };
    const result = await dynamodb.send(new GetCommand(params));
    return result.Item || null;
  } catch (error) {
    console.error(`Error fetching profile for userId ${userId}:`, error);
    return null;
  }
}

async function getUserIdByPhone(phone) {
  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: "#phone = :p",
      ExpressionAttributeNames: { "#phone": "phone" },
      ExpressionAttributeValues: { ":p": phone },
    }));
    return result.Items?.[0]?.userId || null;
  } catch (error) {
    console.error(`Error finding userId by phone ${phone}:`, error);
    return null;
  }
}

exports.sendFriendRequest = async (req, res) => {
  const { from, to } = req.body;

  if (!from || !to || from === to) {
    return res.status(400).json({ success: false, message: "Thiếu thông tin hoặc không thể gửi cho chính mình" });
  }

  // Kiểm tra người nhận có tồn tại
  const toUser = await getUserProfile(to);
  if (!toUser) {
    return res.status(404).json({ success: false, message: "Không tìm thấy người nhận" });
  }

  const requestId = uuidv4();
  const item = {
    requestId,
    from,
    to, // ✅ dùng trực tiếp
    status: "pending",
    createdAt: new Date().toISOString(),
  };

  try {
    await dynamodb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    res.json({ success: true, message: "Đã gửi lời mời" });
  } catch (err) {
    console.error("Lỗi gửi:", err);
    res.status(500).json({ success: false, message: "Lỗi máy chủ", error: err.message });
  }
};

exports.getSentRequests = async (req, res) => {
  const { userId } = req.params;
  try {
    const scan = await dynamodb.send(new ScanCommand({
      TableName              : TABLE_NAME,
      FilterExpression       : "#from = :u AND #status = :p",
      ExpressionAttributeNames: { "#from": "from", "#status": "status" },
      ExpressionAttributeValues: { ":u": userId, ":p": "pending" },
    }));

    const sent = await Promise.all(
      (scan.Items ?? []).map(async it => {
        const user = await getUserProfile(it.to);
        return {
          ...it,
          toUser: {
            name   : user?.name   ?? "Không rõ",
            avatar : user?.avatar ?? "/default-avatar.png",
          },
        };
      }),
    );
    res.json({ success: true, sent });
  } catch (err) {
    console.error("❌ getSentRequests:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};


exports.getReceivedRequests = async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "#to = :toVal AND #status = :statusVal",
      ExpressionAttributeNames: { "#to": "to", "#status": "status" },
      ExpressionAttributeValues: { ":toVal": userId, ":statusVal": "pending" }
    }));

    const enriched = await Promise.all(
      result.Items.map(async (item) => {
        const user = await getUserProfile(item.from);
        return {
          ...item,
          fromUser: {
            name: user?.name || "Không rõ",
            avatar: user?.avatar || "/default-avatar.png",
          }
        };
      })
    );
    res.json({ success: true, received: enriched });
  } catch (err) {
    console.error("Lỗi lấy nhận:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};

exports.acceptFriendRequest = async (req, res) => {
  const { requestId } = req.body;
  try {
    const request = await dynamodb.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "requestId = :rid",
      ExpressionAttributeValues: { ":rid": requestId },
    }));
    const friendRequest = request.Items?.[0];
    if (!friendRequest) return res.status(404).json({ success: false, message: "Không tìm thấy lời mời" });

    const { from, to } = friendRequest;
    const createdAt = new Date().toISOString();

    await Promise.all([
      dynamodb.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { requestId },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": "accepted" },
      })),
      dynamodb.send(new PutCommand({ TableName: FRIENDS_TABLE, Item: { userId: from, friendId: to, createdAt } })),
      dynamodb.send(new PutCommand({ TableName: FRIENDS_TABLE, Item: { userId: to, friendId: from, createdAt } })),
    ]);

    res.json({ success: true, message: "Đã đồng ý kết bạn" });
  } catch (err) {
    console.error("Lỗi accept:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};

exports.rejectFriendRequest = async (req, res) => {
  const { requestId } = req.body;
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { requestId },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "rejected" },
    }));
    res.json({ success: true, message: "Đã từ chối" });
  } catch (err) {
    console.error("Lỗi reject:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};

exports.cancelFriendRequest = async (req, res) => {
  const { requestId } = req.body;
  try {
    await dynamodb.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { requestId } }));
    res.json({ success: true, message: "Đã thu hồi" });
  } catch (err) {
    console.error("Lỗi cancel:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};

exports.getFriendsList = async (req, res) => {
  const { userId } = req.params;
  try {
    const params = {
      TableName: FRIENDS_TABLE,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": userId },
    };

    const result = await dynamodb.send(new QueryCommand(params));
    const friends = await Promise.all(
      (result.Items || []).map(async (item) => {
        const user = await getUserProfile(item.friendId);
        return {
          userId: item.friendId,
          name: user?.name || "Không rõ",
          avatar: user?.avatar || "/default-avatar.png",
          phone: user?.phone || null,
        };
      })
    );
    res.json({ success: true, friends });
  } catch (err) {
    console.error("Lỗi getFriendsList:", err);
    res.status(500).json({ success: false, message: "Lỗi server", error: err.message });
  }
};

// controller.js
exports.deleteFriend = async (req, res) => {
  const { userId, friendId } = req.body;
  try {
    await dynamodb.send(new DeleteCommand({
      TableName: FRIENDS_TABLE,
      Key: { userId, friendId },
    }));

    await dynamodb.send(new DeleteCommand({
      TableName: FRIENDS_TABLE,
      Key: { userId: friendId, friendId: userId },
    }));

    res.json({ success: true, message: "Đã xóa bạn thành công" });
  } catch (err) {
    console.error("❌ Lỗi xóa bạn:", err);
    res.status(500).json({ success: false, message: "Lỗi xóa bạn", error: err.message });
  }
};
// Chuẩn hóa số điện thoại (VD: 0123456789 => 84123456789)
function normalizePhone(phone) {
  if (phone.startsWith("0")) {
    return "84" + phone.slice(1);
  }
  return phone;
}

