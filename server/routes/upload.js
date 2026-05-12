const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authMiddleware } = require("./users");
const logger = require("../utils/logger");

const router = express.Router();

// 确保 uploads 目录存在
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 配置：保存到 uploads/ 目录，限制 5MB
const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, uploadDir); },
  filename: function(req, file, cb) {
    var ext = path.extname(file.originalname) || ".jpg";
    var name = Date.now() + "_" + Math.random().toString(36).substring(2, 8) + ext;
    cb(null, name);
  },
});

var upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function(req, file, cb) {
    var allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowed.indexOf(file.mimetype) > -1) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 JPG/PNG/GIF/WebP 格式"));
    }
  },
});

// POST /api/upload/image
// 上传图片，返回可访问的 URL
router.post("/image", authMiddleware, function(req, res) {
  upload.single("file")(req, res, function(err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.json({ code: -1, message: "图片不能超过 5MB" });
        }
        return res.json({ code: -1, message: "上传失败: " + err.message });
      }
      return res.json({ code: -1, message: err.message || "上传失败" });
    }
    if (!req.file) {
      return res.json({ code: -1, message: "请选择图片" });
    }
    // 构建可访问的 URL
    var baseUrl = req.protocol + "://" + req.get("host");
    var url = baseUrl + "/uploads/" + req.file.filename;
    logger.info("图片上传: user=" + req.user.id + " file=" + req.file.filename);
    res.json({
      code: 0,
      data: { url: url, filename: req.file.filename },
      message: "上传成功",
    });
  });
});

module.exports = router;