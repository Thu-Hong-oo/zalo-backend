const express = require("express");
const path = require("path");
const app = express();
const port = 8080;

// Phục vụ các file tĩnh từ thư mục hiện tại
app.use(express.static(__dirname));

app.listen(port, () => {
  console.log(`Test server running at http://localhost:${port}`);
  console.log(
    `Open http://localhost:${port}/chat-group-socket.html in your browser`
  );
});
