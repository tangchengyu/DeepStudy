const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const modulePath = path.join(__dirname, "..", "renderer", "local-image-import.js");

function withTempDirectory(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepstudy-image-test-"));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("copies a supported absolute image into app-managed storage", () => {
  assert.equal(fs.existsSync(modulePath), true, "local image importer module must exist");
  const { importLocalImage } = require(modulePath);
  withTempDirectory((root) => {
    const source = path.join(root, "论文阅读步骤.png");
    const destination = path.join(root, "managed");
    fs.writeFileSync(source, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = importLocalImage(source, destination, () => "imported.png");
    assert.deepEqual(result, { id: "imported.png", type: "image/png", size: 4 });
    assert.deepEqual(fs.readFileSync(path.join(destination, result.id)), fs.readFileSync(source));
  });
});

test("rejects unsafe or unsupported local image paths", () => {
  assert.equal(fs.existsSync(modulePath), true, "local image importer module must exist");
  const { importLocalImage } = require(modulePath);
  withTempDirectory((root) => {
    const destination = path.join(root, "managed");
    const textFile = path.join(root, "notes.txt");
    const oversized = path.join(root, "large.png");
    fs.writeFileSync(textFile, "not an image");
    fs.writeFileSync(oversized, Buffer.alloc(16 * 1024 * 1024 + 1));
    assert.throws(() => importLocalImage("relative.png", destination), /绝对路径/);
    assert.throws(() => importLocalImage(path.join(root, "missing.png"), destination), /不存在/);
    assert.throws(() => importLocalImage(root, destination), /文件/);
    assert.throws(() => importLocalImage(textFile, destination), /图片格式/);
    assert.throws(() => importLocalImage(oversized, destination), /16 MB/);
  });
});

test("writes note images atomically and removes a failed temporary file", () => {
  const { writeBufferAtomically } = require(modulePath);
  withTempDirectory((root) => {
    const target = path.join(root, "saved.png");
    writeBufferAtomically(target, Buffer.from("image"), () => "pending.tmp");
    assert.equal(fs.readFileSync(target, "utf8"), "image");
    assert.equal(fs.existsSync(path.join(root, "pending.tmp")), false);

    const failedTarget = path.join(root, "failed.png");
    assert.throws(
      () => writeBufferAtomically(failedTarget, Buffer.from("partial"), () => "failed.tmp", Object.assign(Object.create(fs), {
        renameSync() { throw new Error("rename failed"); },
      })),
      /rename failed/,
    );
    assert.equal(fs.existsSync(path.join(root, "failed.tmp")), false);
    assert.equal(fs.existsSync(failedTarget), false);
  });
});

test("imports an absolute-path image through the atomic writer", () => {
  const { importLocalImage } = require(modulePath);
  withTempDirectory((root) => {
    const source = path.join(root, "source.png");
    const destination = path.join(root, "managed");
    fs.writeFileSync(source, Buffer.from("image"));
    const failingFs = Object.assign(Object.create(fs), {
      renameSync() { throw new Error("rename failed"); },
    });
    assert.throws(
      () => importLocalImage(source, destination, () => "saved.png", failingFs),
      /rename failed/,
    );
    assert.equal(fs.existsSync(path.join(destination, "saved.png")), false);
    assert.equal(fs.readdirSync(destination).length, 0);
  });
});
