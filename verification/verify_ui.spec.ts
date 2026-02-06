import { test, expect } from '@playwright/test';
import path from 'path';

test('verify figma plugin ui', async ({ page }) => {
  const uiPath = 'file://' + path.resolve('ui.html');
  await page.goto(uiPath);

  // Wait for content to load
  await page.waitForSelector('.app-wrapper');

  // Initial state (AI Bridge tab)
  await page.screenshot({ path: 'verification/ui_initial.png' });

  // Switch to Paste HTML tab
  await page.click('button[data-tab="paste"]');
  await expect(page.locator('#paste-tab')).toBeVisible();
  await page.screenshot({ path: 'verification/ui_paste_tab.png' });

  // Switch to Upload / URL tab
  await page.click('button[data-tab="upload"]');
  await expect(page.locator('#upload-tab')).toBeVisible();
  await page.screenshot({ path: 'verification/ui_url_tab.png' });

  // Test URL input
  await page.fill('#url-input', 'https://example.com');
  await page.screenshot({ path: 'verification/ui_url_entered.png' });
});
