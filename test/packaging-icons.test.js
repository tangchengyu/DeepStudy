const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
const packScript = fs.readFileSync(path.join(root, "scripts", "pack.js"), "utf8");

function pngDimensions(filePath) {
  const data = fs.readFileSync(filePath);
  assert.equal(data.subarray(1, 4).toString("ascii"), "PNG");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("master desktop package uses the next public master version", () => {
  assert.equal(pkg.version, "1.2.46");
  assert.doesNotMatch(pkg.version, /local/i);
});

test("packaging uses the DeepStudy clock icon on macOS and Windows", () => {
  assert.equal(pkg.build.mac.icon, "build/deepstudy.icns");
  assert.equal(pkg.build.win.icon, "build/deepstudy.ico");

  const icns = fs.readFileSync(path.join(root, pkg.build.mac.icon));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
});

test("packaging PNG icon names match their real dimensions", () => {
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    assert.deepEqual(
      pngDimensions(path.join(root, "build", "icons", `${size}x${size}.png`)),
      [size, size],
    );
  }
});

test("pack script invokes electron-builder through node for paths with spaces", () => {
  assert.match(packScript, /require\.resolve\(['"]electron-builder\/out\/cli\/cli\.js['"]\)/);
  assert.match(packScript, /spawn\(process\.execPath,\s*\[builderCliPath,\s*\.\.\.args\]/);
  assert.doesNotMatch(packScript, /shell:\s*true/);
});
