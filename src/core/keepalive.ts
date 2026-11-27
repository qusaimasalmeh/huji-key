import type { SiteKey } from './types';

export const SITE_ORIGINS: Record<SiteKey, string> = {
  moodle: 'https://moodle.huji.ac.il',
  csMoodle: 'https://moodle2.cs.huji.ac.il'
};

export function siteKeyFromOrigin(originOrUrl: string): SiteKey | null {
  try {
    const { origin } = new URL(originOrUrl);
    if (origin === SITE_ORIGINS.moodle) return 'moodle';
    if (origin === SITE_ORIGINS.csMoodle) return 'csMoodle';
    return null;
  } catch {
    return null;
  }
}

export function extractSesskeyFromHtml(html: string): string | undefined {
  const logoutMatch = html.match(/logout\.php\?[^"']*sesskey=([A-Za-z0-9]+)/);
  if (logoutMatch?.[1]) return logoutMatch[1];
  const cfgMatch = html.match(/"sesskey"\s*:\s*"([A-Za-z0-9]+)"/);
  return cfgMatch?.[1];
}

export function classifyKeepAliveResult(input: {
  status: number;
  type?: string;
  redirected?: boolean;
  url?: string;
  bodyText?: string;
  jsonPayload?: unknown;
  expectJson?: boolean;
}): { outcome: 'ok' | 'logged_out' | 'retry_get' | 'error'; sesskey?: string; reason?: string } {
  if (input.type === 'opaqueredirect' || (input.status >= 300 && input.status < 400)) {
    return { outcome: 'logged_out', reason: 'redirected' };
  }

  if (input.url) {
    const lowerUrl = input.url.toLowerCase();
    if (lowerUrl.includes('idp.cc.huji.ac.il') || lowerUrl.includes('/login/')) {
      return { outcome: 'logged_out', reason: 'login_url' };
    }
  }

  if (Array.isArray(input.jsonPayload) && input.jsonPayload.length > 0) {
    const first = input.jsonPayload[0] as {
      error?: boolean;
      exception?: { errorcode?: string };
    };
    if (first?.error) {
      const code = first.exception?.errorcode ?? '';
      if (code === 'servicerequireslogin') {
        return { outcome: 'logged_out', reason: code };
      }
      if (code === 'invalidsesskey') {
        return { outcome: 'retry_get', reason: code };
      }
      return { outcome: 'retry_get', reason: code || 'ajax_error' };
    }
    return { outcome: 'ok' };
  }

  if (input.status >= 200 && input.status < 300) {
    const body = input.bodyText ?? '';
    if (body.includes('id="login"') || body.includes('idp.cc.huji.ac.il/simplesaml')) {
      return { outcome: 'logged_out', reason: 'login_markup' };
    }
    if (input.expectJson) {
      return { outcome: 'retry_get', reason: 'invalid_json' };
    }
    const sesskey = extractSesskeyFromHtml(body);
    return { outcome: 'ok', sesskey };
  }

  return { outcome: 'error', reason: `http_${input.status}` };
}
