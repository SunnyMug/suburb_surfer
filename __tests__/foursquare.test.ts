import { describe, it, expect } from 'vitest';
import { buildVenueContext, FsqVenue } from '../app/api/_lib/foursquare';

describe('buildVenueContext', () => {
  it('returns empty string when no venues are found', () => {
    const context = buildVenueContext([], 'Granville', 'Sydney');
    expect(context).toBe('');
  });

  it('formats verified venue list accurately', () => {
    const venues: FsqVenue[] = [
      { name: 'Via Napoli Pizzeria', category: 'Restaurant', cuisine: 'pizza', lat: -33.814, lng: 151.170 },
      { name: 'Kosuke Ramen', category: 'Restaurant', lat: -33.815, lng: 151.169 },
    ];
    const context = buildVenueContext(venues, 'Lane Cove', 'Sydney');
    expect(context).toContain('VERIFIED DINING DIRECTORY — 2 real food & drink venues confirmed for Lane Cove, Sydney');
    expect(context).toContain('• Via Napoli Pizzeria (Restaurant · pizza)');
    expect(context).toContain('• Kosuke Ramen (Restaurant)');
    expect(context).toContain('STRICT RULE: You MUST only recommend venues from the above list');
  });

  it('successfully fetches real venues for a suburb with fallback geocoding', async () => {
    const { fetchSuburbVenues } = await import('../app/api/_lib/foursquare');
    const venues = await fetchSuburbVenues('Paddington', 'Sydney');
    expect(Array.isArray(venues)).toBe(true);
    expect(venues.length).toBeGreaterThan(0);
    expect(venues[0]).toHaveProperty('name');
    expect(venues[0]).toHaveProperty('category');
  }, 20000);
});

