import { test, expect } from '@playwright/test';

test.describe('E2E Authentication and User Workflows', () => {
  test('User Registration, Login, Profile and Navigation', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Visit homepage
    await page.goto('/');
    await expect(page.locator('h2')).toContainText('Welcome Back');

    // 2. Switch to Register page
    await page.click('text=Register');
    await expect(page.locator('h2')).toContainText('Create Account');

    // 3. Register a new user
    const uniqueUsername = `user_${Date.now()}`;
    await page.fill('input[type="text"]', uniqueUsername);
    // Find the password input (second input field)
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // After registration it goes back to Welcome Back login screen
    await expect(page.locator('h2')).toContainText('Welcome Back');

    // 4. Log in
    await page.fill('input[type="text"]', uniqueUsername);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should login successfully and show brand title
    await expect(page.locator('.sidebar-brand h1')).toContainText('Private AI Assistant');

    // 5. Open Profile settings
    const profileBtn = page.locator(`text=👤 ${uniqueUsername}`);
    await expect(profileBtn).toBeVisible();
    await profileBtn.click({ force: true });
    await expect(page.locator('.modal-content h3')).toContainText('User Profile Settings');

    // 6. Update preferences
    await page.fill('input[placeholder="Your preferred name"]', 'E2E Tester');
    await page.fill('input[placeholder="e.g. 32421"]', '90210');
    await page.click('text=Save Profile');

    // Modal should close (wait for it to disappear)
    await expect(page.locator('.modal-content h3')).not.toBeVisible();

    // 7. Verify Calendar Navigation
    await page.click('text=My Calendar');
    await expect(page.locator('h3:has-text("Schedule for")')).toBeVisible();
  });
});
