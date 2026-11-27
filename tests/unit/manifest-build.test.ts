import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Chrome and Firefox MV3 builds', () => {
  it('produces valid Chrome and Firefox manifests with existing files and minimal permissions', () => {
    execSync('npm run build', { stdio: 'pipe' });

    for (const target of ['chrome', 'firefox'] as const) {
      const dir = path.resolve('dist', target);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

      expect(manifest.manifest_version).toBe(3);
      expect(manifest.permissions).toEqual(['storage', 'alarms']);
      expect(manifest.permissions).not.toContain('tabs');
      expect(manifest.host_permissions).toEqual([
        'https://idp.cc.huji.ac.il/*',
        'https://gauth.huji.ac.il/*',
        'https://moodle.huji.ac.il/*',
        'https://moodle2.cs.huji.ac.il/*'
      ]);

      for (const iconPath of Object.values(manifest.icons) as string[]) {
        expect(fs.existsSync(path.join(dir, iconPath))).toBe(true);
      }
      expect(fs.existsSync(path.join(dir, manifest.action.default_popup))).toBe(true);
      expect(fs.existsSync(path.join(dir, manifest.options_ui.page))).toBe(true);

      expect(fs.existsSync(path.join(dir, 'background/worker.js'))).toBe(true);
      for (const cs of manifest.content_scripts as Array<{ js?: string[] }>) {
        for (const scriptPath of cs.js ?? []) {
          expect(fs.existsSync(path.join(dir, scriptPath))).toBe(true);
        }
      }

      if (target === 'chrome') {
        expect(manifest.background.service_worker).toBe('background/worker.js');
        expect(manifest.background.scripts).toBeUndefined();
      } else {
        expect(manifest.background.scripts).toEqual(['background/worker.js']);
        expect(manifest.background.service_worker).toBeUndefined();
        expect(manifest.browser_specific_settings.gecko.data_collection_permissions.required).toEqual([
          'none'
        ]);
      }
    }
  });
});
