import { ext } from '../shared/browser';
import { runIdpAutoLogin } from './idp-login-core';

void runIdpAutoLogin(document).catch(() => {});

ext.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'session' && changes.unlockedCredentials?.newValue) {
    void runIdpAutoLogin(document).catch(() => {});
  }
});
