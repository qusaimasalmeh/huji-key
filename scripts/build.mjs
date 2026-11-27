import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const VERSION = pkg.version;

const BASE_MANIFEST = {
  manifest_version: 3,
  name: 'HUJI Key — Auto OTP & Moodle Keep-Alive',
  short_name: 'HUJI Key',
  version: VERSION,
  description:
    'Unofficial student helper: local auto-OTP login for HUJI portals and smart Moodle keep-alive.',
  icons: {
    '16': 'icons/icon-16.png',
    '32': 'icons/icon-32.png',
    '48': 'icons/icon-48.png',
    '128': 'icons/icon-128.png'
  },
  permissions: ['storage', 'alarms'],
  host_permissions: [
    'https://idp.cc.huji.ac.il/*',
    'https://gauth.huji.ac.il/*',
    'https://moodle.huji.ac.il/*',
    'https://moodle2.cs.huji.ac.il/*'
  ],
  action: {
    default_popup: 'popup/popup.html',
    default_title: 'HUJI Key',
    default_icon: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    }
  },
  options_ui: {
    page: 'options/options.html',
    open_in_tab: true
  },
  content_scripts: [
    {
      matches: ['https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login*'],
      js: ['content/idp-login.js'],
      run_at: 'document_idle'
    },
    {
      matches: ['https://gauth.huji.ac.il/*'],
      js: ['content/gauth-capture.js'],
      run_at: 'document_idle'
    },
    {
      matches: ['https://moodle.huji.ac.il/*', 'https://moodle2.cs.huji.ac.il/*'],
      js: ['content/moodle-keepalive.js'],
      run_at: 'document_idle'
    }
  ]
};

function createManifest(target) {
  if (target === 'chrome') {
    return {
      ...BASE_MANIFEST,
      background: {
        service_worker: 'background/worker.js'
      }
    };
  }
  return {
    ...BASE_MANIFEST,
    background: {
      scripts: ['background/worker.js']
    },
    browser_specific_settings: {
      gecko: {
        id: 'huji-key@student-tools.local',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    }
  };
}

const ENTRY_POINTS = {
  'background/worker': 'src/background/worker.ts',
  'content/idp-login': 'src/content/idp-login.ts',
  'content/gauth-capture': 'src/content/gauth-capture.ts',
  'content/moodle-keepalive': 'src/content/moodle-keepalive.ts',
  'popup/popup': 'src/popup/popup.ts',
  'options/options': 'src/options/options.ts'
};

const STATIC_COPIES = [
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
  ['assets/icons/icon-16.png', 'icons/icon-16.png'],
  ['assets/icons/icon-32.png', 'icons/icon-32.png'],
  ['assets/icons/icon-48.png', 'icons/icon-48.png'],
  ['assets/icons/icon-128.png', 'icons/icon-128.png']
];

async function buildTarget(target) {
  const outdir = path.resolve('dist', target);
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });

  await build({
    entryPoints: ENTRY_POINTS,
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120', 'firefox140'],
    minify: false,
    sourcemap: false,
    legalComments: 'none'
  });

  for (const [srcRel, destRel] of STATIC_COPIES) {
    const srcPath = path.resolve(srcRel);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Missing required static file: ${srcRel}`);
    }
    const destPath = path.join(outdir, destRel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  fs.writeFileSync(
    path.join(outdir, 'manifest.json'),
    JSON.stringify(createManifest(target), null, 2) + '\n'
  );
  console.log(`Built ${target} extension at dist/${target}`);
}

await buildTarget('chrome');
await buildTarget('firefox');
