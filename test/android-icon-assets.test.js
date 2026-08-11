const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const res = path.join(root, "deepstudy-app", "android", "app", "src", "main", "res");

function readPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  let offset = 8;
  let colorType = null;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") colorType = data[9];
    if (type === "IDAT") chunks.push(data);
    offset += 12 + length;
  }
  assert.equal(colorType, 6, `${filePath} must be RGBA so transparent launcher padding can be verified`);
  return { width, height, rows: inflateRgbaRows(Buffer.concat(chunks), width, height) };
}

function inflateRgbaRows(idat, width, height) {
  const inflated = zlib.inflateSync(idat);
  const stride = width * 4;
  const rows = [];
  let previous = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[offset++];
    const raw = Buffer.from(inflated.subarray(offset, offset + stride));
    offset += stride;
    const row = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? row[index - 4] : 0;
      const up = previous[index];
      const upLeft = index >= 4 ? previous[index - 4] : 0;
      if (filter === 0) row[index] = raw[index];
      else if (filter === 1) row[index] = (raw[index] + left) & 0xff;
      else if (filter === 2) row[index] = (raw[index] + up) & 0xff;
      else if (filter === 3) row[index] = (raw[index] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[index] = (raw[index] + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
    rows.push(row);
    previous = row;
  }
  return rows;
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? up : upLeft;
}

function alphaBounds(png) {
  let left = png.width;
  let top = png.height;
  let right = -1;
  let bottom = -1;
  png.rows.forEach((row, y) => {
    for (let x = 0; x < png.width; x += 1) {
      if (row[x * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  });
  return { left, top, right, bottom };
}

test("Android launcher icons use density-specific dimensions", () => {
  const sizes = new Map([
    ["mdpi", { launcher: 48, foreground: 108 }],
    ["hdpi", { launcher: 72, foreground: 162 }],
    ["xhdpi", { launcher: 96, foreground: 216 }],
    ["xxhdpi", { launcher: 144, foreground: 324 }],
    ["xxxhdpi", { launcher: 192, foreground: 432 }],
  ]);
  for (const [density, expected] of sizes) {
    const dir = path.join(res, `mipmap-${density}`);
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const png = readPng(path.join(dir, name));
      assert.deepEqual([png.width, png.height], [expected.launcher, expected.launcher], `${density}/${name}`);
    }
    const foreground = readPng(path.join(dir, "ic_launcher_foreground.png"));
    assert.deepEqual([foreground.width, foreground.height], [expected.foreground, expected.foreground], `${density}/ic_launcher_foreground.png`);
  }
});

test("Android adaptive launcher foreground leaves safe transparent padding", () => {
  const png = readPng(path.join(res, "mipmap-xxxhdpi", "ic_launcher_foreground.png"));
  const bounds = alphaBounds(png);
  const margin = Math.round(png.width * 0.14);
  assert.ok(bounds.left >= margin, `left foreground margin ${bounds.left}px should be at least ${margin}px`);
  assert.ok(bounds.top >= margin, `top foreground margin ${bounds.top}px should be at least ${margin}px`);
  assert.ok(png.width - 1 - bounds.right >= margin, "right foreground margin is too small");
  assert.ok(png.height - 1 - bounds.bottom >= margin, "bottom foreground margin is too small");
});
