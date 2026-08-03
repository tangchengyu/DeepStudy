const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function writeBufferAtomically(targetPath, buffer, createTempName, fileSystem = fs) {
  const directory = path.dirname(targetPath);
  const tempNameFactory = typeof createTempName === "function"
    ? createTempName
    : () => `.${path.basename(targetPath)}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  const tempName = path.basename(String(tempNameFactory()));
  const tempPath = path.join(directory, tempName);
  try {
    fileSystem.writeFileSync(tempPath, buffer, { flag: "wx" });
    fileSystem.renameSync(tempPath, targetPath);
  } catch (error) {
    try { fileSystem.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

function importLocalImage(sourcePath, destinationDir, createId) {
  const source = String(sourcePath || "").trim();
  if (!source || (!path.isAbsolute(source) && !path.win32.isAbsolute(source))) {
    throw new Error("图片必须使用绝对路径。");
  }
  if (!fs.existsSync(source)) throw new Error("本地图片不存在。");

  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error("本地图片路径必须指向文件。");

  const sourceExtension = path.extname(source).slice(1).toLowerCase();
  const extension = sourceExtension === "jpeg" ? "jpg" : sourceExtension;
  const type = IMAGE_TYPES[sourceExtension];
  if (!type) throw new Error("不支持此图片格式。");
  if (stat.size > MAX_IMAGE_BYTES) throw new Error("图片不能超过 16 MB。");

  const idFactory = typeof createId === "function"
    ? createId
    : () => `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  const id = String(idFactory(extension));
  if (!id || path.basename(id) !== id || path.extname(id).slice(1).toLowerCase() !== extension) {
    throw new Error("图片存储名称无效。");
  }

  fs.mkdirSync(destinationDir, { recursive: true });
  fs.copyFileSync(source, path.join(destinationDir, id));
  return { id, type, size: stat.size };
}

module.exports = { MAX_IMAGE_BYTES, importLocalImage, writeBufferAtomically };
