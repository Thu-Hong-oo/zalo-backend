require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const multer = require("multer");
const path = require("path");
const { createServer } = require("http");
const { Server } = require("socket.io");
const jwt = require('jsonwebtoken');
const User = require('./modules/user/userService');

const PORT = process.env.PORT;

// Import routes
const authRoutes = require("./modules/auth/routes");
const userRoutes = require("./modules/user/routes");
const groupRoutes = require("./modules/group/group.route");
const friendRoutes = require("./modules/friend/routes");
const conversationRoutes = require("./modules/conversation/routes");

const { routes: videoCallRoutes, initializeVideoSocket } = require("./modules/videoCall/videoCall.route");

const {
  routes: chatGroupRoutes,
  socket: initializeChatGroupSocket,
} = require("./modules/chatGroup");
const {
  routes: chatRoutes,
  socket: initializeChatSocket,
} = require("./modules/chat");

// Initialize express app
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});
app.set('io', io);

// Store connected users
const connectedUsers = new Map();

// Multer config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "..", "uploads", "files"));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + Math.floor(Math.random() * 100000) + path.extname(file.originalname);
    cb(null, uniqueName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// Middleware
app.use(
  cors({
    origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:8081","http://localhost:8082"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type", "Authorization", "Accept", "Content-Length", "X-Requested-With", "Access-Control-Allow-Origin"
    ],
    exposedHeaders: ["Content-Length", "X-Requested-With"],
    credentials: true,
    maxAge: 86400,
  })
);

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use((req, res, next) => {
  req.upload = upload;
  next();
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/chat-group", chatGroupRoutes);
app.use("/api/video-call", videoCallRoutes);

// Socket authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error - No token provided'));
    }

    // Remove 'Bearer ' prefix if exists
    const tokenString = token.startsWith('Bearer ') ? token.slice(7) : token;
    const decoded = jwt.verify(tokenString, process.env.JWT_SECRET);

    // Lấy user từ DB
    const user = await User.getByPhone(decoded.phone);
    console.log('User:', user);
    if (!user) return next(new Error('User not found'));

    socket.user = {
      phone: user.phone,
      name: user.name,
      avatar: user.avatar || null
    };

    // Store socket in connectedUsers Map
    if (user.phone) {
      connectedUsers.set(user.phone, socket);
    }

    console.log('Socket authenticated for user:', socket.user);
    next();
  } catch (err) {
    console.error('Socket authentication error:', err);
    next(new Error('Authentication error - Invalid token'));
  }
});

// Basic socket connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    if (socket.user && socket.user.phone) {
      connectedUsers.delete(socket.user.phone);
    }
    console.log('User disconnected:', socket.id);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: "error",
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found",
  });
});

// Initialize socket connections
initializeChatSocket(io);
initializeChatGroupSocket(io);
initializeVideoSocket(io, connectedUsers);

// Start server
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server đang chạy tại http://localhost:${PORT}`);
});
