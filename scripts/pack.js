// Helper script to run electron-builder with Chinese mirrors
const { spawn, execSync } = require('child_process');

// Auto-cleanup: kill zombie processes and old dist/ before building
try {
  execSync(
    'powershell.exe -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -match \'deepstudy|7za\' } | Stop-Process -Force"',
    { stdio: 'ignore', timeout: 5000 },
  );
} catch (e) {
  // cleanup best-effort
}

// Set mirrors for China
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';

const builderCliPath = require.resolve('electron-builder/out/cli/cli.js');
const args = process.argv.slice(2);

console.log('Electron Mirror:', process.env.ELECTRON_MIRROR);
console.log('Builder Binaries Mirror:', process.env.ELECTRON_BUILDER_BINARIES_MIRROR);
console.log('Running electron-builder with args:', args.join(' '));

const child = spawn(process.execPath, [builderCliPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('close', (code) => {
  process.exit(code);
});
