const express = require("express");
require("dotenv").config();
const router = express.Router();
const authMiddleware = require("../../middleware/auth");
const { DynamoDB } = require("aws-sdk");
const dynamoDB = new DynamoDB.DocumentClient();
const { v4: uuidv4 } = require("uuid");
const twilio = require('twilio');
const { sendCallMessage } = require("../chat");

// Twilio configuration
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Generate Twilio Access Token
const generateAccessToken = async (req, res) => {
  try {
    const { identity } = req.body;
    const userPhone = req.user.phone;
    
    const AccessToken = twilio.jwt.AccessToken;
    const VideoGrant = AccessToken.VideoGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: identity || userPhone }
    );

    const videoGrant = new VideoGrant();
    token.addGrant(videoGrant);

    res.json({
      status: 'success',
      data: {
        token: token.toJwt(),
        identity: identity || userPhone,
        name: req.user.name || userPhone,
        avatar: req.user.avatar || ''
      }
    });
  } catch (error) {
    console.error('Error generating access token:', error);
    res.status(500).json({
      status: 'error',
      message: 'Không thể tạo access token'
    });
  }
};

// Lấy access token cho Twilio Video.
const createRoom = async (req, res) => {
  try {
    const { roomName, type = 'group' } = req.body;
    const userPhone = req.user.phone;

    const room = await twilioClient.video.rooms.create({
      uniqueName: roomName,
      type: type,
      maxParticipants: type === 'peer-to-peer' ? 2 : 50,
    });

    // Enhanced call record with more timing information
    const callRecord = {
      callId: uuidv4(),
      roomSid: room.sid,
      roomName: room.uniqueName,
      createdBy: userPhone,
      status: 'created',
      type: 'video',
      maxParticipants: room.maxParticipants,
      participants: [userPhone],
      timing: {
        createdAt: Date.now(),
        startedAt: null,
        endedAt: null,
        duration: 0,
        lastActivityAt: Date.now()
      },
      metadata: {
        deviceInfo: req.headers['user-agent'],
        ipAddress: req.ip,
        callQuality: null
      },
      updatedAt: Date.now()
    };

    await dynamoDB.put({
      TableName: process.env.VIDEO_CALL_TABLE,
      Item: callRecord
    }).promise();

    res.json({
      status: 'success',
      data: {
        room: {
          sid: room.sid,
          name: room.uniqueName,
          status: room.status
        },
        callId: callRecord.callId
      }
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).json({
      status: 'error',
      message: 'Không thể tạo phòng video call'
    });
  }
};

// Get call history
const getCallHistory = async (req, res) => {
  try {
    const userPhone = req.user.phone;
    const { limit = 20, lastEvaluatedKey } = req.query;

    const params = {
      TableName: process.env.VIDEO_CALL_TABLE,
      FilterExpression: 'contains(participants, :userPhone) OR createdBy = :userPhone',
      ExpressionAttributeValues: {
        ':userPhone': userPhone
      },
      Limit: parseInt(limit),
      ScanIndexForward: false
    };

    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = JSON.parse(lastEvaluatedKey);
    }

    const result = await dynamoDB.scan(params).promise();

    res.json({
      status: 'success',
      data: {
        calls: result.Items,
        pagination: {
          hasMore: !!result.LastEvaluatedKey,
          lastEvaluatedKey: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
        }
      }
    });
  } catch (error) {
    console.error('Error getting call history:', error);
    res.status(500).json({
      status: 'error',
      message: 'Không thể lấy lịch sử cuộc gọi'
    });
  }
};

// Get call statistics
const getCallStats = async (req, res) => {
  try {
    const { callId } = req.params;
    const userPhone = req.user.phone;

    const callData = await dynamoDB.get({
      TableName: process.env.VIDEO_CALL_TABLE,
      Key: { callId }
    }).promise();

    if (!callData.Item) {
      return res.status(404).json({
        status: 'error',
        message: 'Không tìm thấy thông tin cuộc gọi'
      });
    }

    // Calculate duration if call has ended
    let duration = 0;
    if (callData.Item.timing.endedAt && callData.Item.timing.startedAt) {
      duration = Math.floor((callData.Item.timing.endedAt - callData.Item.timing.startedAt) / 1000);
    } else if (callData.Item.timing.startedAt) {
      duration = Math.floor((Date.now() - callData.Item.timing.startedAt) / 1000);
    }

    // Get room details from Twilio if available
    let roomDetails = null;
    if (callData.Item.roomSid) {
      try {
        const room = await twilioClient.video.rooms(callData.Item.roomSid).fetch();
        roomDetails = {
          status: room.status,
          duration: room.duration,
          participants: room.participants
        };
      } catch (error) {
        console.error('Error fetching room details:', error);
      }
    }

    res.json({
      status: 'success',
      data: {
        callId: callData.Item.callId,
        status: callData.Item.status,
        duration: duration,
        timing: {
          created: new Date(callData.Item.timing.createdAt).toISOString(),
          started: callData.Item.timing.startedAt ? new Date(callData.Item.timing.startedAt).toISOString() : null,
          ended: callData.Item.timing.endedAt ? new Date(callData.Item.timing.endedAt).toISOString() : null,
          lastActivity: new Date(callData.Item.timing.lastActivityAt).toISOString()
        },
        participants: callData.Item.participants,
        roomDetails
      }
    });
  } catch (error) {
    console.error('Error getting call stats:', error);
    res.status(500).json({
      status: 'error',
      message: 'Không thể lấy thông tin cuộc gọi'
    });
  }
};

// Handle Twilio webhook events
const handleRoomEvent = async (req, res) => {
  try {
    const { RoomSid, RoomStatus, RoomName, Timestamp } = req.body;

    // Find the call record by roomSid
    const result = await dynamoDB.scan({
      TableName: process.env.VIDEO_CALL_TABLE,
      FilterExpression: 'roomSid = :roomSid',
      ExpressionAttributeValues: {
        ':roomSid': RoomSid
      }
    }).promise();

    if (result.Items.length > 0) {
      const callRecord = result.Items[0];
      const updates = {
        status: RoomStatus.toLowerCase(),
        'timing.lastActivityAt': Date.now()
      };

      // Update timing based on room status
      if (RoomStatus === 'in-progress' && !callRecord.timing.startedAt) {
        updates['timing.startedAt'] = Date.now();
      } else if (['completed', 'failed'].includes(RoomStatus)) {
        updates['timing.endedAt'] = Date.now();
        if (callRecord.timing.startedAt) {
          updates['timing.duration'] = Math.floor((Date.now() - callRecord.timing.startedAt) / 1000);
        }
      }

      await dynamoDB.update({
        TableName: process.env.VIDEO_CALL_TABLE,
        Key: { callId: callRecord.callId },
        UpdateExpression: 'SET #status = :status, timing.lastActivityAt = :lastActivityAt, ' +
          (updates['timing.startedAt'] ? 'timing.startedAt = :startedAt, ' : '') +
          (updates['timing.endedAt'] ? 'timing.endedAt = :endedAt, ' : '') +
          (updates['timing.duration'] ? 'timing.duration = :duration, ' : '') +
          'updatedAt = :updatedAt',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': updates.status,
          ':lastActivityAt': updates['timing.lastActivityAt'],
          ':updatedAt': Date.now(),
          ...(updates['timing.startedAt'] && { ':startedAt': updates['timing.startedAt'] }),
          ...(updates['timing.endedAt'] && { ':endedAt': updates['timing.endedAt'] }),
          ...(updates['timing.duration'] && { ':duration': updates['timing.duration'] })
        }
      }).promise();
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling room event:', error);
    res.sendStatus(500);
  }
};

// Socket events for video calling
const initializeVideoSocket = (io, connectedUsers) => {
  io.on('connection', (socket) => {
    // Lấy userPhone từ socket.user.phone
    const userPhone = socket.user && socket.user.phone;
    if (userPhone) {
      connectedUsers.set(userPhone, socket);
      socket.on('disconnect', () => {
        connectedUsers.delete(userPhone);
      });
    }
    // Video call invitation
    socket.on('video-call-invite', async (data) => {
      console.log('video-call-invite socket.user:', socket.user);
      try {
        const { receiverPhone, roomName, callType = 'video' } = data;
        const senderPhone = socket.user.phone;
        
        if (!receiverPhone || !senderPhone) {
          console.error('video-call-invite: thiếu receiverPhone hoặc senderPhone', { receiverPhone, senderPhone });
          socket.emit('call-error', { message: 'Thiếu thông tin người gọi hoặc người nhận' });
          return;
        }

        // Lấy thông tin người gọi từ database sử dụng phone-index
        const userResult = await dynamoDB.query({
          TableName: process.env.USER_TABLE,
          IndexName: 'phone-index',
          KeyConditionExpression: 'phone = :phone',
          ExpressionAttributeValues: {
            ':phone': senderPhone
          }
        }).promise();

        const senderName = userResult.Items[0]?.name || senderPhone;
        const senderAvatar = userResult.Items[0]?.avatar || '';

        // Create call record
        const callId = uuidv4();
        const callRecord = {
          callId,
          roomName,
          senderPhone,
          receiverPhone,
          callType,
          status: 'ringing',
          timing: {
            createdAt: Date.now(),
            startedAt: null,
            endedAt: null,
            duration: 0,
            lastActivityAt: Date.now()
          }
        };

        await dynamoDB.put({
          TableName: process.env.VIDEO_CALL_TABLE,
          Item: callRecord
        }).promise();

        // Send invitation to receiver
        const receiverSocket = connectedUsers.get(receiverPhone);
        if (receiverSocket) {
          console.log('Emit incoming-video-call:', {
            callId,
            senderPhone,
            roomName,
            callType,
            senderName,
            senderAvatar,
          });
          
          receiverSocket.emit('incoming-video-call', {
            callId,
            senderPhone,
            roomName,
            callType,
            senderName,
            senderAvatar,
          });
        }

        // Send confirmation to sender with user info
        socket.emit('call-invitation-sent', { 
          callId, 
          status: 'sent',
          name: senderName,
          avatar: senderAvatar
        });

        // Gửi message thông báo bắt đầu cuộc gọi
        await sendCallMessage({
          conversationId: [senderPhone, receiverPhone].sort().join('_'),
          senderPhone,
          receiverPhone,
          status: "started",
          callId,
          type: callType
        });

        // Auto decline after 30 seconds
        setTimeout(async () => {
          try {
            const callData = await dynamoDB.get({
              TableName: process.env.VIDEO_CALL_TABLE,
              Key: { callId }
            }).promise();

            if (callData.Item && callData.Item.status === 'ringing') {
              await dynamoDB.update({
                TableName: process.env.VIDEO_CALL_TABLE,
                Key: { callId },
                UpdateExpression: 'SET #status = :status, timing.endedAt = :endedAt',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':status': 'missed',
                  ':endedAt': Date.now()
                }
              }).promise();

              socket.emit('call-timeout', { callId });
              if (receiverSocket) {
                receiverSocket.emit('call-timeout', { callId });
              }

              // Gửi message thông báo nhỡ cuộc gọi
              await sendCallMessage({
                conversationId: [senderPhone, receiverPhone].sort().join('_'),
                senderPhone,
                receiverPhone,
                status: "missed",
                callId,
                type: callType
              });
            }
          } catch (error) {
            console.error('Error in call timeout:', error);
          }
        }, 30000);

      } catch (error) {
        console.error('Error in video-call-invite:', error);
        socket.emit('call-error', { message: 'Không thể thực hiện cuộc gọi' });
      }
    });

    // Accept video call
    socket.on('accept-video-call', async (data) => {
      try {
        const { callId } = data;
        const receiverPhone = socket.user.phone;

        await dynamoDB.update({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #status = :status, timing.startedAt = :startedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'accepted',
            ':startedAt': Date.now()
          }
        }).promise();

        // Get call details
        const callData = await dynamoDB.get({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId }
        }).promise();

        if (callData.Item) {
          const senderSocket = connectedUsers.get(callData.Item.senderPhone);
          if (senderSocket) {
            senderSocket.emit('call-accepted', {
              callId,
              roomName: callData.Item.roomName
            });
          }
        }

        socket.emit('call-accepted', {
          callId,
          roomName: callData.Item.roomName
        });

      } catch (error) {
        console.error('Error accepting call:', error);
        socket.emit('call-error', { message: 'Không thể chấp nhận cuộc gọi' });
      }
    });

    // Decline video call
    socket.on('decline-video-call', async (data) => {
      try {
        const { callId } = data;
        const receiverPhone = socket.user.phone;

        const callData = await dynamoDB.get({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId }
        }).promise();

        if (!callData.Item) {
          console.error('decline-video-call: không tìm thấy call record', { callId });
          return;
        }

        const { senderPhone } = callData.Item;
        if (!senderPhone) {
          console.error('decline-video-call: thiếu senderPhone trong call record', { callId });
          return;
        }

        await dynamoDB.update({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #status = :status, timing.endedAt = :endedAt',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'declined',
            ':endedAt': Date.now()
          }
        }).promise();

        const senderSocket = connectedUsers.get(senderPhone);
        if (senderSocket) {
          senderSocket.emit('call-declined', { callId });
        }

        // Gửi message thông báo từ chối cuộc gọi
        await sendCallMessage({
          conversationId: [senderPhone, receiverPhone].sort().join('_'),
          senderPhone,
          receiverPhone,
          status: "declined",
          callId,
          type: callData.Item.callType || 'video'
        });

      } catch (error) {
        console.error('Error declining call:', error);
      }
    });

    // End video call
    socket.on('end-video-call', async (data) => {
      try {
        const { callId } = data;
        const userPhone = socket.user.phone;

        const callData = await dynamoDB.get({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId }
        }).promise();

        if (!callData.Item) {
          console.error('end-video-call: không tìm thấy call record', { callId });
          return;
        }

        const { senderPhone, receiverPhone } = callData.Item;
        if (!senderPhone || !receiverPhone) {
          console.error('end-video-call: thiếu senderPhone hoặc receiverPhone trong call record', { callId });
          return;
        }

        const endedAt = Date.now();
        const duration = callData.Item.timing.startedAt ? 
          Math.floor((endedAt - callData.Item.timing.startedAt) / 1000) : 0;

        await dynamoDB.update({
          TableName: process.env.VIDEO_CALL_TABLE,
          Key: { callId },
          UpdateExpression: 'SET #status = :status, timing.endedAt = :endedAt, timing.#duration = :duration, endedBy = :endedBy',
          ExpressionAttributeNames: { '#status': 'status', '#duration': 'duration' },
          ExpressionAttributeValues: {
            ':status': 'ended',
            ':endedAt': endedAt,
            ':duration': duration,
            ':endedBy': userPhone
          }
        }).promise();

        const otherPhone = senderPhone === userPhone ? receiverPhone : senderPhone;
        const otherSocket = connectedUsers.get(otherPhone);
        if (otherSocket) {
          otherSocket.emit('call-ended', { callId });
        }

        // Gửi message thông báo kết thúc cuộc gọi
        await sendCallMessage({
          conversationId: [userPhone, otherPhone].sort().join('_'),
          senderPhone: userPhone,
          receiverPhone: otherPhone,
          status: "ended",
          duration,
          callId,
          type: callData.Item.callType || 'video'
        });

      } catch (error) {
        console.error('Error ending call:', error);
      }
    });
  });
};

// Route cập nhật trạng thái cuộc gọi video
const updateCallStatus = async (req, res) => {
  try {
    const { callId, roomName, status, duration, receiverPhone, senderPhone } = req.body;
    if (!callId || !status) {
      return res.status(400).json({ status: 'error', message: 'Thiếu callId hoặc status' });
    }

    if (!senderPhone || !receiverPhone) {
      return res.status(400).json({ status: 'error', message: 'Thiếu senderPhone hoặc receiverPhone' });
    }

    // Lấy thông tin cuộc gọi hiện tại
    const callData = await dynamoDB.get({
      TableName: process.env.VIDEO_CALL_TABLE,
      Key: { callId }
    }).promise();

    if (!callData.Item) {
      return res.status(404).json({ status: 'error', message: 'Không tìm thấy cuộc gọi' });
    }

    // Sử dụng ExpressionAttributeNames để tránh reserved keyword 'duration'
    let UpdateExpression = 'SET #status = :status, updatedAt = :updatedAt';
    let ExpressionAttributeNames = { '#status': 'status' };
    let ExpressionAttributeValues = {
      ':status': status,
      ':updatedAt': Date.now()
    };

    if (duration) {
      UpdateExpression += ', #timing.#duration = :duration';
      ExpressionAttributeNames['#timing'] = 'timing';
      ExpressionAttributeNames['#duration'] = 'duration';
      ExpressionAttributeValues[':duration'] = duration;
    }

    await dynamoDB.update({
      TableName: process.env.VIDEO_CALL_TABLE,
      Key: { callId },
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues
    }).promise();

    // Gửi message thông báo vào chat nếu chưa có message cùng status/callId
    try {
      const conversationId = [senderPhone, receiverPhone].sort().join('_');
      const params = {
        TableName: process.env.MESSAGE_TABLE,
        IndexName: 'conversationIndex',
        KeyConditionExpression: 'conversationId = :conversationId',
        ExpressionAttributeValues: { ':conversationId': conversationId },
      };
      const result = await dynamoDB.query(params).promise();
      const existed = result.Items && result.Items.some(m => m.callStatus === status && m.callId === callId);
      if (!existed) {
        await sendCallMessage({
          conversationId,
          senderPhone,
          receiverPhone,
          status,
          duration,
          type: callData.Item.callType || 'video',
          callId
        });
      }
    } catch (error) {
      console.error('Error sending call message:', error);
      // Không throw error ở đây để không ảnh hưởng đến việc cập nhật trạng thái cuộc gọi
    }

    res.json({ status: 'success' });
  } catch (err) {
    console.error('Error updating call status:', err);
    res.status(500).json({ status: 'error', message: 'Không thể cập nhật trạng thái cuộc gọi' });
  }
};

// Routes
router.post('/token', authMiddleware, generateAccessToken);
router.post('/room', authMiddleware, createRoom);
router.get('/history', authMiddleware, getCallHistory);
router.get('/stats/:callId', authMiddleware, getCallStats);
router.post('/webhook/room', handleRoomEvent);
router.post('/status', authMiddleware, updateCallStatus);


module.exports = {
  routes: router,
  initializeVideoSocket
};