import { describe, it, expect } from 'vitest';
import { buildVenueContext, FsqVenue, isPointInPolygon } from '../app/api/_lib/foursquare';

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

describe('isPointInPolygon', () => {
  const squarePolygon = {
    type: 'Polygon' as const,
    coordinates: [
      // Outer box from (10, 10) to (20, 20)
      [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 20],
        [10, 10],
      ],
      // Interior hole from (14, 14) to (16, 16)
      [
        [14, 14],
        [16, 14],
        [16, 16],
        [14, 16],
        [14, 14],
      ],
    ],
  };

  it('correctly identifies point strictly inside boundary polygon', () => {
    expect(isPointInPolygon([12, 12], squarePolygon)).toBe(true);
    expect(isPointInPolygon([18, 18], squarePolygon)).toBe(true);
  });

  it('correctly rejects point outside boundary polygon', () => {
    expect(isPointInPolygon([5, 5], squarePolygon)).toBe(false);
    expect(isPointInPolygon([25, 25], squarePolygon)).toBe(false);
  });

  it('correctly rejects point sitting inside an interior exclusion hole', () => {
    expect(isPointInPolygon([15, 15], squarePolygon)).toBe(false);
  });

  it('correctly handles MultiPolygon geometries', () => {
    const multiPolygon = {
      type: 'MultiPolygon' as const,
      coordinates: [
        // Island 1
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
        // Island 2
        [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
            [10, 10],
          ],
        ],
      ],
    };

    expect(isPointInPolygon([1, 1], multiPolygon)).toBe(true);
    expect(isPointInPolygon([11, 11], multiPolygon)).toBe(true);
    expect(isPointInPolygon([5, 5], multiPolygon)).toBe(false);
  });

  it('returns true as safe fallback when geometry is missing or undefined', () => {
    expect(isPointInPolygon([10, 10], undefined)).toBe(true);
  });
});

