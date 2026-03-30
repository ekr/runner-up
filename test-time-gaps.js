/**
 * Node.js test for time gap removal in extractAndHarmonizeRegions.
 *
 * Tests that when overlapping-only regions are extracted from tracks
 * where one has an extra loop, the time values are adjusted to remove
 * the time spent in the non-matching loop segment.
 *
 * Run: node test-time-gaps.js
 */

const fs = require('fs');
const vm = require('vm');

// Load the source files into a shared context (they use global functions)
const gpxSource = fs.readFileSync('static/gpx.js', 'utf-8');
const alignmentSource = fs.readFileSync('static/alignment.js', 'utf-8');

const context = vm.createContext({ Math, Infinity, console, Array, Map });
vm.runInContext(gpxSource, context);
vm.runInContext(alignmentSource, context);

// Parse the test fixture GPX files
const noLoopGpx = fs.readFileSync('e2e/fixtures/main-route-no-loop.gpx', 'utf-8');
const withLoopGpx = fs.readFileSync('e2e/fixtures/main-route-with-loop.gpx', 'utf-8');

// We need DOMParser for parseGPX - use a minimal substitute
// Instead, directly call alignment functions with pre-built track data

// Build tracks manually matching the fixture data
// main-route-no-loop: straight east, 11 points, 10s apart
// main-route-with-loop: same but with 6-point loop in the middle adding 70s

function makePoint(lat, lon, timeSec, distanceMeters) {
  return { lat, lon, time: timeSec, distance: distanceMeters, elevation: 100 };
}

// Helper to compute cumulative distance using haversine
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildTrack(coords) {
  // coords: [{lat, lon, time}]
  let cumulDist = 0;
  const track = [];
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      cumulDist += haversine(coords[i - 1].lat, coords[i - 1].lon,
                              coords[i].lat, coords[i].lon);
    }
    track.push(makePoint(coords[i].lat, coords[i].lon, coords[i].time, cumulDist));
  }
  return track;
}

// No-loop track: straight east along lat 37.285
const noLoopCoords = [];
for (let i = 0; i <= 10; i++) {
  noLoopCoords.push({ lat: 37.285, lon: -122.060 + i * 0.001, time: i * 10 });
}
const noLoopTrack = buildTrack(noLoopCoords);

// With-loop track: same start, loop in middle, same end
const withLoopCoords = [
  // Segment 1: same as no-loop (0-50s)
  { lat: 37.285, lon: -122.060, time: 0 },
  { lat: 37.285, lon: -122.059, time: 10 },
  { lat: 37.285, lon: -122.058, time: 20 },
  { lat: 37.285, lon: -122.057, time: 30 },
  { lat: 37.285, lon: -122.056, time: 40 },
  { lat: 37.285, lon: -122.055, time: 50 },
  // Loop (non-matching, 60-110s)
  { lat: 37.2855, lon: -122.055, time: 60 },
  { lat: 37.286, lon: -122.055, time: 70 },
  { lat: 37.286, lon: -122.0545, time: 80 },
  { lat: 37.286, lon: -122.054, time: 90 },
  { lat: 37.2855, lon: -122.054, time: 100 },
  { lat: 37.285, lon: -122.054, time: 110 },
  // Segment 2: back on main route (120-150s)
  { lat: 37.285, lon: -122.053, time: 120 },
  { lat: 37.285, lon: -122.052, time: 130 },
  { lat: 37.285, lon: -122.051, time: 140 },
  { lat: 37.285, lon: -122.050, time: 150 },
];
const withLoopTrack = buildTrack(withLoopCoords);

// Run alignment
const alignment = vm.runInContext(
  `findOverlappingRegions(track1, track2)`,
  Object.assign(context, { track1: noLoopTrack, track2: withLoopTrack })
);

if (!alignment) {
  console.error('FAIL: alignment is null');
  process.exit(1);
}

console.log(`Overlapping regions: ${alignment.overlappingRegions.length}`);
console.log(`Has multiple segments: ${alignment.hasMultipleSegments}`);

if (!alignment.hasMultipleSegments) {
  console.error('FAIL: Expected multiple segments (loop should create a gap)');
  process.exit(1);
}

// Create harmonized tracks (overlapping only)
const harmonized = vm.runInContext(
  `createHarmonizedTracks(track1, track2, alignment, true)`,
  Object.assign(context, { track1: noLoopTrack, track2: withLoopTrack, alignment })
);

const hTrack1 = harmonized.harmonizedTrack1;
const hTrack2 = harmonized.harmonizedTrack2;

console.log(`\nHarmonized track1 (no-loop): ${hTrack1.length} points`);
console.log(`  Time range: ${hTrack1[0].time} - ${hTrack1[hTrack1.length - 1].time}`);
console.log(`\nHarmonized track2 (with-loop): ${hTrack2.length} points`);
console.log(`  Time range: ${hTrack2[0].time} - ${hTrack2[hTrack2.length - 1].time}`);

// Check for time gaps in the looped track
let maxGap = 0;
for (let i = 1; i < hTrack2.length; i++) {
  const gap = hTrack2[i].time - hTrack2[i - 1].time;
  if (gap > maxGap) maxGap = gap;
}
console.log(`\nMax time gap in looped track: ${maxGap}s`);

// The fixture has 10s between consecutive points.
// Without the fix: gap between segments is 70s (time 50 -> 120)
// With the fix: gap should be ~0s (time adjusted to be continuous)
let failed = false;

if (maxGap > 15) {
  console.error(`FAIL: Max time gap is ${maxGap}s (expected <= 15s). Non-matching segment time not removed.`);
  failed = true;
} else {
  console.log('PASS: No large time gaps in looped track');
}

// Check that final times are comparable
const timeDiff = Math.abs(hTrack1[hTrack1.length - 1].time - hTrack2[hTrack2.length - 1].time);
console.log(`\nFinal time difference: ${timeDiff}s`);
if (timeDiff > 30) {
  console.error(`FAIL: Final time difference is ${timeDiff}s (expected < 30s). Loop time not removed.`);
  failed = true;
} else {
  console.log('PASS: Final times are comparable');
}

if (failed) {
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
}
