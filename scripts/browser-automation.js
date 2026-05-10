const { chromium } = require('playwright');
const fs = require('fs');
const https = require('https');

const TARGET_URL = process.env.TARGET_URL;
const TASK = process.env.TASK;
const SELECTOR = process.env.SELECTOR || 'body';

if (!TARGET_URL || !TASK) {
  console.error('Missing required env vars: TARGET_URL, TASK');
  process.exit(1);
}

const VALID_TASKS = ['screenshot', 'scrape', 'test', 'audit'];
if (!VALID_TASKS.includes(TASK)) {
  console.error(`Invalid task: ${TASK}. Must be one of: ${VALID_TASKS.join(', ')}`);
  process.exit(1);
}

const RESULT = { url: TARGET_URL, task: TASK, timestamp: new Date().toISOString(), success: false };
const LOGS = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  LOGS.push(line);
}

async function checkRobotsTxt(url) {
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const response = await fetch(robotsUrl);
    if (response.status === 200) {
      const text = await response.text();
      const path = new URL(url).pathname;
      const disallowed = text.split('\n').some(line => {
        const match = line.match(/^Disallow:\s*(.+)/i);
        return match && path.startsWith(match[1]);
      });
      if (disallowed) {
        log('robots.txt disallows this path. Skipping.');
        return false;
      }
    }
  } catch (e) {
    log(`robots.txt check failed: ${e.message}`);
  }
  return true;
}

async function run() {
  log(`Starting browser automation: ${TASK} on ${TARGET_URL}`);

  const allowed = await checkRobotsTxt(TARGET_URL);
  if (!allowed) {
    RESULT.error = 'Blocked by robots.txt';
    RESULT.success = false;
    fs.writeFileSync('result.json', JSON.stringify(RESULT, null, 2));
    fs.writeFileSync('logs.txt', LOGS.join('\n'));
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'ForgeClaw-Bot/1.0 (Automated Testing; +https://github.com/DeviousDevv303/forgeclaw)',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  try {
    log('Navigating...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 30000 });
    log('Navigation complete');

    // Rate limit: 1s pause after navigation
    await new Promise(r => setTimeout(r, 1000));

    if (TASK === 'screenshot' || TASK === 'audit') {
      log('Taking screenshot...');
      await page.screenshot({ path: 'screenshot.png', fullPage: true });
      RESULT.screenshot = 'screenshot.png';
    }

    if (TASK === 'scrape' || TASK === 'audit') {
      log(`Scraping selector: ${SELECTOR}`);
      const content = await page.locator(SELECTOR).innerText().catch(() => '');
      RESULT.scraped = content;
      RESULT.selector = SELECTOR;
    }

    if (TASK === 'test' || TASK === 'audit') {
      RESULT.consoleErrors = consoleErrors;
      RESULT.pageErrors = consoleErrors.length;
    }

    RESULT.success = true;
    log('Task completed successfully');

  } catch (error) {
    log(`Error: ${error.message}`);
    RESULT.error = error.message;
    RESULT.success = false;
  } finally {
    await browser.close();
  }

  fs.writeFileSync('result.json', JSON.stringify(RESULT, null, 2));
  fs.writeFileSync('logs.txt', LOGS.join('\n'));

  process.exit(RESULT.success ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  fs.writeFileSync('result.json', JSON.stringify({ ...RESULT, error: err.message, success: false }, null, 2));
  fs.writeFileSync('logs.txt', LOGS.join('\n') + '\nFatal: ' + err.message);
  process.exit(1);
});
