const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the current directory
app.use(express.static(path.join(__dirname, "static")));
app.use(express.static(path.join(__dirname, "test")));
app.use("/tracks", express.static(path.join(__dirname, "test_files")));

// List available GPX files from test_files/
app.get("/api/tracks", (req, res) => {
  const dir = path.join(__dirname, "test_files");
  fs.readdir(dir, (err, files) => {
    if (err) {
      return res.json([]);
    }
    const gpxFiles = files.filter((f) => f.toLowerCase().endsWith(".gpx"));
    res.json(gpxFiles);
  });
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
