// ffmpeg-static only downloads the binary for the machine running npm install.
// The Windows build needs ffmpeg.exe next to it, so fetch that one as well.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.dirname(require.resolve('ffmpeg-static/package.json'));
if (fs.existsSync(path.join(dir, 'ffmpeg.exe'))) process.exit(0);

console.log('Downloading ffmpeg.exe for the Windows build…');
execFileSync(process.execPath, [path.join(dir, 'install.js')], {
  cwd: dir,
  stdio: 'inherit',
  env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' },
});
