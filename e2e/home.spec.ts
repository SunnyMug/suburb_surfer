import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test('loads the initial layout and map correctly', async ({ page }) => {
    await page.goto('/');

    // Check if the title is visible
    await expect(page.locator('h1').filter({ hasText: 'Suburb Surfer' })).toBeVisible();

    // The city selector should have "Sydney" selected by default
    const citySelect = page.locator('select');
    await expect(citySelect).toHaveValue('Sydney');

    // The random suburb button (🎲) or "Where should I go?" button should exist
    const button = page.getByRole('button', { name: /Where should I go?/i });
    await expect(button).toBeVisible();

    // Check if the iframe map is rendered
    const map = page.locator('iframe[title="Suburb map"]');
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('src', /maps\.google\.com/);
  });

  test('can select a different city', async ({ page }) => {
    await page.goto('/');

    // Select Melbourne
    const citySelect = page.locator('select');
    await citySelect.selectOption('Melbourne');
    
    // The map URL should update
    const map = page.locator('iframe[title="Suburb map"]');
    await expect(map).toHaveAttribute('src', /Melbourne/);
  });

  test('loads demographics correctly when random suburb is clicked', async ({ page }) => {
    // Mock the API response
    await page.route('/api/explore*', async route => {
      const json = {
        name: 'Mock Suburb',
        is_suburb: true,
        summary: 'A nice place.',
        fun_facts: [],
        local_attractions: [],
        name_etymology: '',
        cuisine_types: [],
        restaurant_recommendations: [],
        key_events: [],
        notable_people: [],
        heritage_sites: [],
        demographics: {
          data_source: 'Mock Census',
          data_year: '2021',
          population: '10,000',
          top_ancestries: [{ name: 'English', percentage: 20 }],
          top_languages: [{ name: 'Mandarin', percentage: 15 }]
        },
        venuesAvailable: true,
        rawVenues: []
      };
      await route.fulfill({ json });
    });

    await page.goto('/');
    
    // Click the random suburb button
    const button = page.getByRole('button', { name: /Where should I go?/i });
    await button.click();

    // Wait for the mock suburb to load
    await expect(page.getByRole('heading', { name: 'Mock Suburb' })).toBeVisible();

    // Click the Community tab
    const communityTab = page.getByRole('button', { name: /Community/i });
    await expect(communityTab).toBeVisible();
    await communityTab.click();

    // Verify demographics data is visible
    await expect(page.getByText('10,000')).toBeVisible();
    await expect(page.getByText('Mock Census')).toBeVisible();
    await expect(page.getByText('Top Ancestries')).toBeVisible();
  });
});
