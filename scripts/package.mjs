import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const version = pkg.version;

for (const target of ['chrome', 'firefox']) {
  const dir = path.resolve('dist', target);
  const outZip = path.resolve('dist', `huji-key-${target}-v${version}.zip`);
  fs.rmSync(outZip, { force: true });
  execFileSync('zip', ['-r', outZip, '.', '-x', '*.DS_Store'], {
    cwd: dir,
    stdio: 'inherit'
  });
  console.log(`Created ${path.relative(process.cwd(), outZip)}`);
}
