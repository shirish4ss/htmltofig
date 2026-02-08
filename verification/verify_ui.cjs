const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const filePath = 'file://' + path.resolve('ui.html');
  await page.goto(filePath);
  await page.setViewportSize({ width: 480, height: 740 });
  await page.waitForTimeout(1000); // Wait for animations
  await page.screenshot({ path: '/home/jules/verification/ui_mcp.png' });

  // Test tabs
  await page.click('button[data-tab="paste"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/jules/verification/ui_paste.png' });

  await page.click('button[data-tab="upload"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/home/jules/verification/ui_upload.png' });

  await browser.close();
})();
