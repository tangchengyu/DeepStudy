const test = require("node:test");
const assert = require("node:assert/strict");

const {
  compareVersions,
  parseMasterReleaseVersion,
  releasesFromAtom,
  selectLatestUpdate,
} = require("../renderer/update-checker");

const releases = [
  {
    tag_name: "local-v1.2.99-local",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/tangchengyu/DeepStudy/releases/tag/local-v1.2.99-local",
    assets: [{ name: "DeepStudy-Setup-1.2.99-local.exe", browser_download_url: "https://example.test/local.exe" }],
  },
  {
    tag_name: "master-v1.2.41",
    name: "DeepStudy Master 1.2.41",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/tangchengyu/DeepStudy/releases/tag/master-v1.2.41",
    assets: [
      { name: "DeepStudy-Setup-1.2.41.exe", browser_download_url: "https://example.test/win.exe" },
      { name: "DeepStudy-Setup-1.2.41.dmg", browser_download_url: "https://example.test/mac.dmg" },
      { name: "DeepStudy-Android-master-v1.2.41.apk", browser_download_url: "https://example.test/app.apk" },
    ],
  },
  {
    tag_name: "master-v1.2.40",
    draft: false,
    prerelease: false,
    html_url: "https://github.com/tangchengyu/DeepStudy/releases/tag/master-v1.2.40",
    assets: [{ name: "DeepStudy-Setup-1.2.40.exe", browser_download_url: "https://example.test/old.exe" }],
  },
];

test("version comparison handles multi-digit patch numbers", () => {
  assert.equal(compareVersions("1.2.41", "1.2.40"), 1);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.2.40", "1.2.40"), 0);
});

test("only master release tags are eligible for automatic updates", () => {
  assert.equal(parseMasterReleaseVersion("master-v1.2.41"), "1.2.41");
  assert.equal(parseMasterReleaseVersion("local-v1.2.99-local"), null);
  assert.equal(parseMasterReleaseVersion("v1.2.41"), null);
});

test("selects the newest master release asset for the current platform", () => {
  const update = selectLatestUpdate(releases, { currentVersion: "1.2.40", platform: "win32" });
  assert.equal(update.available, true);
  assert.equal(update.latestVersion, "1.2.41");
  assert.equal(update.assetName, "DeepStudy-Setup-1.2.41.exe");
  assert.equal(update.assetUrl, "https://example.test/win.exe");
});

test("reports latest when the installed version already matches the newest release", () => {
  const update = selectLatestUpdate(releases, { currentVersion: "1.2.41", platform: "android" });
  assert.equal(update.available, false);
  assert.equal(update.latestVersion, "1.2.41");
  assert.equal(update.assetName, "DeepStudy-Android-master-v1.2.41.apk");
});

test("builds update candidates from the public GitHub releases Atom feed when the API is blocked", () => {
  const atom = `
    <feed>
      <entry>
        <title>DeepStudy Master 1.2.42</title>
        <link href="https://github.com/tangchengyu/DeepStudy/releases/tag/master-v1.2.42"/>
      </entry>
      <entry>
        <title>DeepStudy Local 1.2.99</title>
        <link href="https://github.com/tangchengyu/DeepStudy/releases/tag/local-v1.2.99-local"/>
      </entry>
    </feed>
  `;
  const update = selectLatestUpdate(releasesFromAtom(atom), { currentVersion: "1.2.41", platform: "win32" });
  assert.equal(update.available, true);
  assert.equal(update.latestVersion, "1.2.42");
  assert.equal(update.assetName, "DeepStudy-Setup-1.2.42.exe");
  assert.equal(
    update.assetUrl,
    "https://github.com/tangchengyu/DeepStudy/releases/download/master-v1.2.42/DeepStudy-Setup-1.2.42.exe",
  );
});
