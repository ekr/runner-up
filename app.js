const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, "test")));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
