const { expect, test } = require('@playwright/test');

function isAnalyticsHost(hostname) {
  return hostname === 'googletagmanager.com'
    || hostname.endsWith('.googletagmanager.com')
    || hostname === 'google-analytics.com'
    || hostname.endsWith('.google-analytics.com')
    || hostname === 'analytics.google.com';
}

test('release endpoint is ready, non-indexable and analytics-free', async ({ page, request }) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    'Remote staging smoke requires PLAYWRIGHT_BASE_URL'
  );

  let analyticsRequestCount = 0;
  page.on('request', (outgoingRequest) => {
    try {
      if (isAnalyticsHost(new URL(outgoingRequest.url()).hostname)) {
        analyticsRequestCount += 1;
      }
    } catch {
      // Playwright can expose non-HTTP browser-internal requests; they are irrelevant here.
    }
  });

  const live = await request.get('/health/live');
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: 'live' });

  const ready = await request.get('/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
  expect(ready.headers()['x-robots-tag']).toBe('noindex, nofollow');

  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');

  const home = await page.goto('/', { waitUntil: 'networkidle' });
  expect(home?.status()).toBe(200);
  expect(home?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  expect(analyticsRequestCount).toBe(0);
});
