(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeepStudyUpdateChecker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RELEASES_API_URL = "https://api.github.com/repos/tangchengyu/DeepStudy/releases?per_page=30";
  const RELEASES_ATOM_URL = "https://github.com/tangchengyu/DeepStudy/releases.atom";
  const RELEASE_DOWNLOAD_BASE_URL = "https://github.com/tangchengyu/DeepStudy/releases/download";
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

  function assetNameForPlatform(version, platform) {
    if (platform === "win32" || platform === "windows") return `DeepStudy-Setup-${version}.exe`;
    if (platform === "darwin" || platform === "mac") return `DeepStudy-Setup-${version}.dmg`;
    if (platform === "android") return `DeepStudy-Android-master-v${version}.apk`;
    return "";
  }

  function atomReleaseAssets(version, tagName) {
    return ["win32", "darwin", "android"]
      .map((platform) => {
        const name = assetNameForPlatform(version, platform);
        return name
          ? {
              name,
              browser_download_url: `${RELEASE_DOWNLOAD_BASE_URL}/${encodeURIComponent(tagName)}/${encodeURIComponent(name)}`,
            }
          : null;
      })
      .filter(Boolean);
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

  function releasesFromAtom(atomText) {
    const text = String(atomText || "");
    const urls = [...text.matchAll(/href=["']([^"']*\/releases\/tag\/([^"']+))["']/gi)]
      .map((match) => ({
        url: match[1].replace(/&amp;/g, "&"),
        tagName: decodeURIComponent(match[2].replace(/&amp;/g, "&")),
      }));
    const seen = new Set();
    return urls
      .filter(({ tagName }) => {
        if (seen.has(tagName)) return false;
        seen.add(tagName);
        return Boolean(parseMasterReleaseVersion(tagName));
      })
      .map(({ tagName, url }) => {
        const version = parseMasterReleaseVersion(tagName);
        return {
          tag_name: tagName,
          name: `DeepStudy Master ${version}`,
          draft: false,
          prerelease: false,
          html_url: url,
          assets: atomReleaseAssets(version, tagName),
        };
      });
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
    RELEASES_ATOM_URL,
    compareVersions,
    parseMasterReleaseVersion,
    releasesFromAtom,
    selectLatestUpdate,
  };
});
