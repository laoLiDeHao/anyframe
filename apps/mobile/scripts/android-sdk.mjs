import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Resolve the SDK before Gradle starts; never download or change system settings. */
export function resolveAndroidSdk(androidDir, env = process.env, userHome = homedir()) {
  const localProperties = join(androidDir, 'local.properties')
  const text = existsSync(localProperties) ? readFileSync(localProperties, 'utf8') : ''
  const configured = /^\s*sdk\.dir\s*[=:]\s*(.*?)\s*$/m.exec(text)?.[1]
  const localPath = configured?.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))).replace(/\\([\\:= ])/g, '$1')
  const candidates = localPath
    ? [resolve(androidDir, localPath)]
    : env.ANDROID_HOME || env.ANDROID_SDK_ROOT
      ? [env.ANDROID_HOME || env.ANDROID_SDK_ROOT]
      : [
          ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Android', 'Sdk')] : []),
          join(userHome, 'Android', 'Sdk'),
          join(userHome, 'Library', 'Android', 'sdk'),
        ]
  const sdk = candidates.find((dir) =>
    existsSync(join(dir, 'platforms')) && existsSync(join(dir, 'build-tools')))
  if (sdk) return resolve(sdk)
  throw new Error(
    `找不到有效 Android SDK（需包含 platforms/ 和 build-tools/）。\n` +
    `  请设置 ANDROID_HOME，或在 ${localProperties} 写入 sdk.dir=C:/path/to/android-sdk。\n` +
    `  已检查：${candidates.join(', ')}`,
  )
}
