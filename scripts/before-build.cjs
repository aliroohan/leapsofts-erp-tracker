'use strict'

const { execSync } = require('node:child_process')

const platformToNode = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux'
}

function nativeHostArch() {
  if (process.platform === 'darwin') {
    try {
      const arm = execSync('sysctl -n hw.optional.arm64', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
      if (arm === '1') return 'arm64'
    } catch {
      // Intel Macs do not define hw.optional.arm64
    }
    return 'x64'
  }
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

/**
 * Skip @electron/rebuild when the target OS is not the host OS.
 * uiohook-napi compiles from source (no usable macOS cross-compile),
 * and node-gyp cannot cross-compile that native addon.
 *
 * Also refuse a macOS arch that is not this Mac's CPU so we do not pack
 * an Electron binary that macOS will reject as "not supported on this Mac".
 */
module.exports = async function beforeBuild(context) {
  const targetPlatform = platformToNode[context.platform.name]
  if (targetPlatform && targetPlatform !== process.platform) {
    console.warn(
      `[beforeBuild] Skipping native rebuild for ${context.platform.name}/${context.arch} ` +
        `(host is ${process.platform}/${process.arch}). uiohook-napi cannot be cross-compiled.`
    )
    return false
  }

  if (process.platform === 'darwin' && context.arch && context.arch !== 'universal') {
    const hostArch = nativeHostArch()
    if (context.arch !== hostArch) {
      throw new Error(
        `[beforeBuild] Refusing macOS ${context.arch} on this ${hostArch} Mac. ` +
          'Build only the host architecture (npm run build:mac).'
      )
    }
  }

  return true
}
