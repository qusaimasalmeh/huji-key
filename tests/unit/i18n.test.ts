// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyDocumentLocale, getDirection, MESSAGES, t } from '../../src/core/i18n';

describe('trilingual i18n', () => {
  it('has identical non-empty keys across EN, HE, and AR', () => {
    const enKeys = Object.keys(MESSAGES.en).sort();
    const heKeys = Object.keys(MESSAGES.he).sort();
    const arKeys = Object.keys(MESSAGES.ar).sort();

    expect(heKeys).toEqual(enKeys);
    expect(arKeys).toEqual(enKeys);

    for (const lang of ['en', 'he', 'ar'] as const) {
      for (const key of enKeys) {
        const val = MESSAGES[lang][key as keyof typeof MESSAGES.en];
        expect(val.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates template placeholders cleanly', () => {
    expect(t('en', 'idpBadgeWaitingFresh', { seconds: 2 })).toContain('2');
    expect(t('he', 'idpBadgeWaitingFresh', { seconds: 2 })).toContain('2');
    expect(t('ar', 'idpBadgeWaitingFresh', { seconds: 2 })).toContain('2');
  });

  it('returns correct writing directions and applies document locale', () => {
    expect(getDirection('en')).toBe('ltr');
    expect(getDirection('he')).toBe('rtl');
    expect(getDirection('ar')).toBe('rtl');

    applyDocumentLocale(document, 'ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    applyDocumentLocale(document, 'en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });
});
