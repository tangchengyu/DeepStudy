(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeepStudyUpdateChecker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RELEASES_API_URL = "https://api.github.com/repos/tangchengyu/DeepStudy/releases?per_page=30";
  const MASTER_TAG_PATTERN = /^master-v(\d+\.\d+\.\d+)$/;

  function parseMasterReleaseVersion(tagName) {
    const match = String(tagName || "").trim().match(MASTER_TAG_PATTERN);
    return match ? match[1] : null;
  }

  function normalizeVersion(version) {
    return String(version || "")
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((part) => {
        const value = Number.parseInt(part, 10);
        return Number.isFinite(value) ? value : 0;
      })
      .slice(0, 3);
  }

  function compareVersions(left, right) {
    const a = normalizeVersion(left);
    const b = normalizeVersion(right);
    for (let index = 0; index < 3; index += 1) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff > 0) return 1;
      if (diff < 0) return -1;
    }
    return 0;
  }

  function assetPatternForPlatform(platform) {
    if (platform === "win32" || platform === "windows") return /\.exe$/i;
    if (platform === "darwin" || platform === "mac") return /\.dmg$/i;
    if (platform === "android") return /\.apk$/i;
    return null;
  }

  function findAsset(release, platform) {
    const pattern = assetPatternForPlatform(platform);
    if (!pattern) return null;
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    return assets.find((asset) =>
      pattern.test(String(asset?.name || "")) && String(asset?.browser_download_url || "").startsWith("http"),
    ) || null;
  }

  function eligibleMasterReleases(releases, platform) {
    return (Array.isArray(releases) ? releases : [])
      .map((release) => ({
        release,
        version: parseMasterReleaseVersion(release?.tag_name),
        asset: findAsset(release, platform),
      }))
      .filter((candidate) =>
        candidate.version
        && candidate.asset
        && !candidate.release?.draft
        && !candidate.release?.prerelease,
      )
      .sort((left, right) => compareVersions(right.version, left.version));
  }

  function selectLatestUpdate(releases, options = {}) {
    const currentVersion = String(options.currentVersion || "0.0.0").trim();
    const platform = options.platform || "";
    const latest = eligibleMasterReleases(releases, platform)[0] || null;
    if (!latest) {
      return {
        available: false,
        currentVersion,
        latestVersion: currentVersion,
        message: "没有找到适用于当前设备的更新包。",
      };
    }
    const available = compareVersions(latest.version, currentVersion) > 0;
    return {
      available,
      currentVersion,
      latestVersion: latest.version,
      tagName: latest.release.tag_name,
      releaseName: latest.release.name || latest.release.tag_name,
      releaseUrl: latest.release.html_url,
      assetName: latest.asset.name,
      assetUrl: latest.asset.browser_download_url,
      message: available ? "发现新版本。" : "当前已是最新版本。",
    };
  }

  return {
    RELEASES_API_URL,
    compareVersions,
    parseMasterReleaseVersion,
    selectLatestUpdate,
  };
});
