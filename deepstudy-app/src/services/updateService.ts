export const RELEASES_API_URL = 'https://api.github.com/repos/tangchengyu/DeepStudy/releases?per_page=30'

export interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

export interface GitHubRelease {
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  assets?: ReleaseAsset[]
}

export interface UpdateResult {
  available: boolean
  currentVersion: string
  latestVersion: string
  tagName?: string
  releaseName?: string
  releaseUrl?: string
  assetName?: string
  assetUrl?: string
  message: string
}

declare const __APP_VERSION__: string

const MASTER_TAG_PATTERN = /^master-v(\d+\.\d+\.\d+)$/

export const currentAppVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export function parseMasterReleaseVersion(tagName: string | undefined | null) {
  const match = String(tagName || '').trim().match(MASTER_TAG_PATTERN)
  return match ? match[1] : null
}

function normalizeVersion(version: string) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
    .slice(0, 3)
}

export function compareVersions(left: string, right: string) {
  const a = normalizeVersion(left)
  const b = normalizeVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff > 0) return 1
    if (diff < 0) return -1
  }
  return 0
}

function assetPatternForPlatform(platform: string) {
  if (platform === 'android') return /\.apk$/i
  if (platform === 'win32' || platform === 'windows') return /\.exe$/i
  if (platform === 'darwin' || platform === 'mac') return /\.dmg$/i
  return null
}

function findAsset(release: GitHubRelease, platform: string) {
  const pattern = assetPatternForPlatform(platform)
  if (!pattern) return null
  return (release.assets || []).find((asset) =>
    pattern.test(String(asset.name || '')) && String(asset.browser_download_url || '').startsWith('http'),
  ) || null
}

export function selectLatestUpdate(
  releases: GitHubRelease[],
  options: { currentVersion: string; platform: string },
): UpdateResult {
  const currentVersion = options.currentVersion
  const candidates = (Array.isArray(releases) ? releases : [])
    .map((release) => ({
      release,
      version: parseMasterReleaseVersion(release.tag_name),
      asset: findAsset(release, options.platform),
    }))
    .filter((candidate) =>
      candidate.version
      && candidate.asset
      && !candidate.release.draft
      && !candidate.release.prerelease,
    )
    .sort((left, right) => compareVersions(right.version!, left.version!))
  const latest = candidates[0]
  if (!latest) {
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      message: '没有找到适用于当前设备的更新包。',
    }
  }
  const available = compareVersions(latest.version!, currentVersion) > 0
  return {
    available,
    currentVersion,
    latestVersion: latest.version!,
    tagName: latest.release.tag_name,
    releaseName: latest.release.name || latest.release.tag_name,
    releaseUrl: latest.release.html_url,
    assetName: latest.asset!.name,
    assetUrl: latest.asset!.browser_download_url,
    message: available ? '发现新版本。' : '当前已是最新版本。',
  }
}

export async function checkForUpdates(fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(RELEASES_API_URL, {
    headers: {
      accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) throw new Error(`检查更新失败：GitHub 返回 HTTP ${response.status}`)
  const releases = await response.json() as GitHubRelease[]
  return selectLatestUpdate(releases, {
    currentVersion: currentAppVersion,
    platform: 'android',
  })
}

export function openUpdateDownload(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error('更新下载链接无效。')
  window.open(url, '_system', 'noopener,noreferrer')
}
