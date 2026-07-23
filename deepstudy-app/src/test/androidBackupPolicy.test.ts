import { describe, expect, it } from 'vitest'
import manifest from '../../android/app/src/main/AndroidManifest.xml?raw'
import dataExtractionRules from '../../android/app/src/main/res/xml/data_extraction_rules.xml?raw'

describe('Android backup policy', () => {
  it('disables app backup and excludes local data from Android 12+ extraction', () => {
    expect(manifest).toContain('android:allowBackup="false"')
    expect(manifest).toContain('android:fullBackupContent="false"')
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"')
    expect(dataExtractionRules).toContain('<exclude domain="database" path="." />')
    expect(dataExtractionRules).toContain('<exclude domain="sharedpref" path="." />')
    expect(dataExtractionRules).toContain('<exclude domain="device_database" path="." />')
    expect(dataExtractionRules).toContain('<exclude domain="device_sharedpref" path="." />')
  })
})
