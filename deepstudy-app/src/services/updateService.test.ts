import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  parseMasterReleaseVersion,
  selectLatestUpdate,
} from './updateService'

const releases = [
  {
    tag_name: 'local-v1.2.99-local',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/tangchengyu/DeepStudy/releases/tag/local-v1.2.99-local',
    assets: [{ name: 'DeepStudy-Setup-1.2.99-local.exe', browser_download_url: 'https://example.test/local.exe' }],
  },
  {
    tag_name: 'master-v1.2.41',
    name: 'DeepStudy Master 1.2.41',
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/tangchengyu/DeepStudy/releases/tag/master-v1.2.41',
    assets: [
      { name: 'DeepStudy-Setup-1.2.41.exe', browser_download_url: 'https://example.test/win.exe' },
      { name: 'DeepStudy-Setup-1.2.41.dmg', browser_download_url: 'https://example.test/mac.dmg' },
      { name: 'DeepStudy-Android-master-v1.2.41.apk', browser_download_url: 'https://example.test/app.apk' },
    ],
  },
]

describe('mobile update service', () => {
  it('compares versions and ignores non-master release tags', () => {
    expect(compareVersions('1.2.41', '1.2.40')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(parseMasterReleaseVersion('master-v1.2.41')).toBe('1.2.41')
    expect(parseMasterReleaseVersion('local-v1.2.99-local')).toBeNull()
  })

  it('selects the Android APK for a newer master release', () => {
    const update = selectLatestUpdate(releases, { currentVersion: '1.2.40', platform: 'android' })
    expect(update.available).toBe(true)
    expect(update.latestVersion).toBe('1.2.41')
    expect(update.assetName).toBe('DeepStudy-Android-master-v1.2.41.apk')
    expect(update.assetUrl).toBe('https://example.test/app.apk')
  })
})
