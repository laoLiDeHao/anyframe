import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveAndroidSdk } from './android-sdk.mjs'

test('SDK preflight resolves configuration and fails before Gradle for missing SDK', () => {
  const root = mkdtempSync(join(tmpdir(), 'anyframe-sdk-'))
  try {
    const android = join(root, 'android')
    const sdk = join(root, 'SDK with spaces')
    mkdirSync(android)
    mkdirSync(join(sdk, 'platforms'), { recursive: true })
    mkdirSync(join(sdk, 'build-tools'))
    assert.throws(() => resolveAndroidSdk(android, {}, root), /找不到有效 Android SDK/)
    assert.equal(resolveAndroidSdk(android, { ANDROID_HOME: sdk }, root), resolve(sdk))
    assert.equal(resolveAndroidSdk(android, { ANDROID_SDK_ROOT: sdk }, root), resolve(sdk))
    const escaped = sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/ /g, '\\ ')
    writeFileSync(join(android, 'local.properties'), `sdk.dir=${escaped}\n`)
    assert.equal(resolveAndroidSdk(android, { ANDROID_HOME: 'invalid' }, root), resolve(sdk))
    writeFileSync(join(android, 'local.properties'), 'sdk.dir=missing\n')
    assert.throws(() => resolveAndroidSdk(android, { ANDROID_HOME: sdk }, root), /已检查/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
