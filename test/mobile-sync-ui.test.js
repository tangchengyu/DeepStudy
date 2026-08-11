const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mineView = fs.readFileSync(path.resolve(__dirname, "..", "deepstudy-app", "src", "views", "MineView.vue"), "utf8");

test("mobile account page keeps sync management behind the first-sync confirmation", () => {
  assert.match(mineView, /firstSyncRequired/);
  assert.match(mineView, /首次同步本机数据/);
  assert.match(mineView, /将上传到账号/);
  assert.match(mineView, /账号已有/);
  assert.match(mineView, /本机将新增/);
  assert.match(mineView, /把账号数据写回本机/);
  assert.match(mineView, /上传 .*? 条；拉取核对 .*? 条；写入本机 .*? 条/);
  assert.match(mineView, /先完成首次同步/);
  assert.match(mineView, /firstSyncComplete && conflicts\.length/);
  assert.match(mineView, /v-else-if="firstSyncComplete"/);
});
