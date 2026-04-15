import * as path from 'path';

export const fixturesDir = path.join(__dirname, '..', 'fixtures');

// Five distinct GPX fixture filenames — one per available track slot (MAX_TRACKS = 5).
export const FIVE_FIXTURE_NAMES = [
  'track1.gpx',
  'track2.gpx',
  'out-and-back-short.gpx',
  'out-and-back-long.gpx',
  'main-route-no-loop.gpx',
] as const;
