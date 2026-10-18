import { test, expect } from './fixtures';

test('local overlay opens without a fragment and canvas stays within resized viewport',async({page})=>{
  await page.goto('/overlay/draft');
  await expect(page.locator('.broadcast-overlay')).toBeVisible();
  await expect(page.locator('.login')).toHaveCount(0);
  for(const size of [{width:1920,height:1080},{width:1280,height:720},{width:390,height:844}]) {
    await page.setViewportSize(size);
    const canvas=page.locator('.overlay');
    await expect.poll(async()=>{const rect=await canvas.boundingBox();return !!rect&&rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=size.width+1&&rect.y+rect.height<=size.height+1;}).toBe(true);
  }
});

test('remote overlay shows a usable login and accepts its role token',async({page})=>{
  await page.route('**/api/access?role=overlay',async route=>{
    if(route.request().method()==='GET') await route.fulfill({json:{local:false,configured:false}});
    else await route.continue();
  });
  await page.goto('/overlay/draft');
  await expect(page.locator('.login')).toBeVisible();
  await page.locator('.login input').fill('e2e-overlay');
  await page.locator('.login button').click();
  await expect(page.locator('.broadcast-overlay')).toBeVisible();
});
