#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process'
import process from 'node:process'

const hostPlatformFlags = {
  darwin: ['--mac'],
  win32: ['--win'],
  linux: ['--linux']
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

/** CPU of this Mac, not Rosetta (`process.arch` can be x64 on Apple Silicon). */
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

function macArchFlag(arch) {
  return arch === 'arm64' ? '--arm64' : '--x64'
}

function requestedMacArches(args) {
  const arches = []
  if (args.includes('--x64')) arches.push('x64')
  if (args.includes('--arm64')) arches.push('arm64')
  if (args.includes('--universal')) arches.push('universal')
  return arches
}

function refuseCrossArchMac(arch, hostArch) {
  fail(
    [
      `Refusing to build macOS ${arch} on this ${hostArch} Mac.`,
      'uiohook-napi must be compiled on the matching CPU. A mismatched .app will not open',
      '("You can’t open the application because this application is not supported on this Mac").',
      `Use npm run build:mac (host ${hostArch} only).`,
      'Intel:     npm run build:mac:intel  →  dist/Leapsofts ERP-*-mac-x64.dmg',
      'Apple Silicon: npm run build:mac:arm  →  dist/Leapsofts ERP-*-mac-arm64.dmg'
    ].join('\n')
  )
}

const args = process.argv.slice(2)
const hostArch = nativeHostArch()
let builderArgs

if (args[0] === '--host' || args.length === 0) {
  const platformFlags = hostPlatformFlags[process.platform]
  if (!platformFlags) {
    fail(`No electron-builder targets for host platform ${process.platform}`)
  }
  builderArgs = [...platformFlags]
  if (process.platform === 'darwin') {
    builderArgs.push(macArchFlag(hostArch))
  }
} else {
  const flagBlob = args.join(' ')
  const needsWin = args.includes('--win') || args.includes('-w') || /(?:^|\s)-[a-z]*w/.test(flagBlob)
  const needsLinux = args.includes('--linux') || args.includes('-l') || /(?:^|\s)-[a-z]*l/.test(flagBlob)
  const needsMac = args.includes('--mac') || args.includes('-m') || /(?:^|\s)-[a-z]*m/.test(flagBlob)

  if (needsWin && process.platform !== 'win32') {
    fail(
      'Windows packages must be built on Windows. uiohook-napi cannot be cross-compiled from this Mac.'
    )
  }
  if (needsLinux && process.platform !== 'linux') {
    fail(
      'Linux packages must be built on Linux. uiohook-napi cannot be cross-compiled from this Mac.'
    )
  }
  if (needsMac && process.platform !== 'darwin') {
    fail('macOS packages must be built on macOS. uiohook-napi cannot be cross-compiled.')
  }

  builderArgs = [...args]

  if (needsMac) {
    let arches = requestedMacArches(args)
    if (arches.includes('universal')) {
      fail(
        'Universal macOS builds are not supported: uiohook-napi cannot be shipped as a working fat binary from one host.'
      )
    }
    if (arches.length === 0) {
      builderArgs.push(macArchFlag(hostArch))
      arches = [hostArch]
    }
    for (const arch of arches) {
      if (arch !== hostArch) {
        refuseCrossArchMac(arch, hostArch)
      }
    }
  }
}

console.log(
  `[electron-builder] native host ${process.platform}/${hostArch} (process.arch=${process.arch})`
)
console.log(`[electron-builder] ${builderArgs.join(' ')}`)

const result = spawnSync(
  process.execPath,
  ['node_modules/electron-builder/cli.js', ...builderArgs],
  { stdio: 'inherit' }
)
process.exit(result.status === null ? 1 : result.status)
