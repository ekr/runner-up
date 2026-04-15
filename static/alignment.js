/**
 * Track Alignment Module
 *
 * Handles alignment of GPS tracks that may have:
 * - Different paces (same route, different speeds)
 * - GPS skew (one device reads systematically longer/shorter)
 * - Partial overlap (out-and-back with different turnaround points)
 * - Added segments (loops that one track has but another doesn't)
 */

/**
 * Represents a matching region between two tracks.
 * @typedef {Object} OverlapRegion
 * @property {number[]} track1Range - [startIdx, endIdx] in track1
 * @property {number[]} track2Range - [startIdx, endIdx] in track2
 * @property {number} track1Distance - Distance in meters for this segment in track1
 * @property {number} track2Distance - Distance in meters for this segment in track2
 * @property {number} harmonizedDistance - Average distance for this segment
 */

/**
 * Represents the alignment result between two tracks.
 * @typedef {Object} AlignmentResult
 * @property {OverlapRegion[]} overlappingRegions - Regions where tracks overlap
 * @property {boolean} hasMultipleSegments - True if there are >1 overlapping segments
 * @property {number} totalHarmonizedDistance - Total distance when harmonized
 */

/**
 * Find all overlapping regions between two tracks.
 * Uses spatial proximity to identify where tracks are following the same route.
 *
 * @param {Object[]} track1 - First track (array of {lat, lon, distance, ...})
 * @param {Object[]} track2 - Second track
 * @param {Object} options - Configuration options
 * @param {number} options.threshold - Max distance in km to consider points matching (default 0.03 = 30m)
 * @param {number} options.searchWindow - How many points ahead to search (default 30)
 * @param {number} options.minSegmentPoints - Minimum points to consider a valid segment (default 3)
 * @returns {AlignmentResult|null} Alignment result or null if tracks don't overlap at start
 */
/**
 * Find all overlapping regions between two tracks using DTW alignment.
 */
function findOverlappingRegions(track1, track2, options = {}) {
  return findOverlappingRegionsWithDTW(track1, track2, options);
}

/**
 * Find where track1 and track2 first intersect.
 */
function findFirstIntersection(track1, track2, threshold, maxSearch) {
  const searchLimit1 = Math.min(maxSearch, track1.length);
  const searchLimit2 = Math.min(maxSearch, track2.length);

  for (let i = 0; i < searchLimit1; i++) {
    for (let j = 0; j < searchLimit2; j++) {
      if (getDistanceFromPointInKm(track1[i], track2[j]) <= threshold) {
        return { t1Index: i, t2Index: j };
      }
    }
  }
  return null;
}

/**
 * Dynamic Time Warping (DTW) alignment for two GPS tracks.
 * Uses Sakoe-Chiba band constraint for efficiency with large tracks.
 *
 * @param {Object[]} track1 - First track
 * @param {Object[]} track2 - Second track
 * @param {number} bandWidth - Maximum allowed warping (as fraction of track length)
 * @returns {Array} Array of [i, j] pairs representing the alignment path
 */
function dtwAlign(track1, track2, bandWidth = 0.1) {
  const n = track1.length;
  const m = track2.length;

  // Band width in indices (at least 50 points, at most 10% of longer track)
  const band = Math.max(50, Math.floor(Math.max(n, m) * bandWidth));

  // Cost matrix - only store current and previous row for memory efficiency
  let prev = new Array(m).fill(Infinity);
  let curr = new Array(m).fill(Infinity);

  // Parent pointers for backtracking (stored sparsely)
  const parents = new Map();

  for (let i = 0; i < n; i++) {
    // Sakoe-Chiba band: j should be within band of the diagonal
    const expectedJ = Math.floor(i * m / n);
    const jMin = Math.max(0, expectedJ - band);
    const jMax = Math.min(m, expectedJ + band);

    for (let j = jMin; j < jMax; j++) {
      const cost = getDistanceFromPointInKm(track1[i], track2[j]);

      let minPrev = Infinity;
      let parent = null;

      if (i === 0 && j === 0) {
        minPrev = 0;
      } else {
        // Check three possible predecessors
        if (i > 0 && prev[j] < minPrev) {
          minPrev = prev[j];
          parent = [i - 1, j];
        }
        if (j > 0 && curr[j - 1] < minPrev) {
          minPrev = curr[j - 1];
          parent = [i, j - 1];
        }
        if (i > 0 && j > 0 && prev[j - 1] < minPrev) {
          minPrev = prev[j - 1];
          parent = [i - 1, j - 1];
        }
      }

      curr[j] = cost + minPrev;
      if (parent) {
        parents.set(i * m + j, parent);
      }
    }

    // Swap rows
    [prev, curr] = [curr, prev];
    curr.fill(Infinity);
  }

  // Backtrack to find alignment path
  const path = [];
  let i = n - 1;
  let j = m - 1;

  // Find best endpoint in last row (in case tracks end differently)
  let bestJ = j;
  let bestCost = prev[j];
  const expectedEndJ = Math.floor((n - 1) * m / n);
  const jMinEnd = Math.max(0, expectedEndJ - band);
  const jMaxEnd = Math.min(m, expectedEndJ + band);
  for (let jj = jMinEnd; jj < jMaxEnd; jj++) {
    if (prev[jj] < bestCost) {
      bestCost = prev[jj];
      bestJ = jj;
    }
  }
  j = bestJ;

  while (i >= 0 && j >= 0) {
    path.unshift([i, j]);
    const parent = parents.get(i * m + j);
    if (!parent) break;
    [i, j] = parent;
  }

  return path;
}

/**
 * Find overlapping regions using DTW alignment.
 * Regions where tracks are close together are "overlapping".
 */
function findOverlappingRegionsWithDTW(track1, track2, options = {}) {
  const {
    threshold = 0.03,  // 30 meters - points closer than this are "matching"
    minSegmentPoints = 3
  } = options;

  if (!track1?.length || !track2?.length) {
    return null;
  }

  // Get DTW alignment
  const alignment = dtwAlign(track1, track2);

  if (alignment.length === 0) {
    return null;
  }

  // Walk through alignment and find regions where points are close
  const regions = [];
  let currentRegion = null;
  let matching = false;
  let prevI = 0, prevJ = 0;

  for (const [i, j] of alignment) {
    const dist = getDistanceFromPointInKm(track1[i], track2[j]);
    const isClose = dist <= threshold;

    if (isClose && !matching) {
      // Start new matching region
      currentRegion = { track1Start: i, track2Start: j };
      matching = true;
    } else if (!isClose && matching) {
      // End current region using previous point
      if (currentRegion) {
        const regionLength = prevI - currentRegion.track1Start;
        if (regionLength >= minSegmentPoints) {
          regions.push(createRegion(
            track1, track2,
            currentRegion.track1Start, prevI,
            currentRegion.track2Start, prevJ
          ));
        }
      }
      matching = false;
      currentRegion = null;
    }

    prevI = i;
    prevJ = j;
  }

  // Close final region if still matching
  if (matching && currentRegion) {
    const lastPair = alignment[alignment.length - 1];
    const regionLength = lastPair[0] - currentRegion.track1Start;
    if (regionLength >= minSegmentPoints) {
      regions.push(createRegion(
        track1, track2,
        currentRegion.track1Start, lastPair[0],
        currentRegion.track2Start, lastPair[1]
      ));
    }
  }

  if (regions.length === 0) {
    return null;
  }

  const totalHarmonized = regions.reduce((sum, r) => sum + r.harmonizedDistance, 0);

  return {
    overlappingRegions: regions,
    hasMultipleSegments: regions.length > 1,
    totalHarmonizedDistance: totalHarmonized,
    alignment: alignment  // Include raw alignment for debugging
  };
}

/**
 * Search for where tracks reconverge after diverging.
 */
function findReconvergence(track1, track2, t1Start, t2Start, threshold) {
  // Search ahead in both tracks for a point where they're close again
  const maxLookahead = 100;

  for (let i = t1Start; i < Math.min(track1.length, t1Start + maxLookahead); i++) {
    for (let j = t2Start; j < Math.min(track2.length, t2Start + maxLookahead); j++) {
      if (getDistanceFromPointInKm(track1[i], track2[j]) <= threshold) {
        return { t1Index: i, t2Index: j };
      }
    }
  }

  return null;
}

/**
 * Create an OverlapRegion from track indices.
 */
function createRegion(track1, track2, t1Start, t1End, t2Start, t2End) {
  // Bounds checking
  t1Start = Math.max(0, Math.min(t1Start, track1.length - 1));
  t1End = Math.max(0, Math.min(t1End, track1.length - 1));
  t2Start = Math.max(0, Math.min(t2Start, track2.length - 1));
  t2End = Math.max(0, Math.min(t2End, track2.length - 1));

  const track1Distance = track1[t1End].distance - track1[t1Start].distance;
  const track2Distance = track2[t2End].distance - track2[t2Start].distance;
  const harmonizedDistance = (track1Distance + track2Distance) / 2;

  return {
    track1Range: [t1Start, t1End],
    track2Range: [t2Start, t2End],
    track1Distance,
    track2Distance,
    harmonizedDistance
  };
}

/**
 * Create harmonized tracks from overlapping regions.
 * Scales distances in each segment to the average distance.
 *
 * @param {Object[]} track1 - First track
 * @param {Object[]} track2 - Second track
 * @param {AlignmentResult} alignment - Alignment result from findOverlappingRegions
 * @param {boolean} overlappingOnly - If true, only include overlapping regions
 * @returns {Object} {harmonizedTrack1, harmonizedTrack2}
 */
function createHarmonizedTracks(track1, track2, alignment, overlappingOnly = false) {
  if (!alignment?.overlappingRegions?.length) {
    return { harmonizedTrack1: track1, harmonizedTrack2: track2 };
  }

  const regions = alignment.overlappingRegions;

  if (overlappingOnly) {
    // Only include points from overlapping regions
    return {
      harmonizedTrack1: extractAndHarmonizeRegions(track1, regions, 0),
      harmonizedTrack2: extractAndHarmonizeRegions(track2, regions, 1)
    };
  } else {
    // Include full tracks but harmonize the overlapping portions
    return {
      harmonizedTrack1: harmonizeFullTrack(track1, regions, 0),
      harmonizedTrack2: harmonizeFullTrack(track2, regions, 1)
    };
  }
}

/**
 * Extract only overlapping regions and harmonize distances.
 */
function extractAndHarmonizeRegions(track, regions, trackIndex) {
  const result = [];
  let cumulativeHarmonizedDistance = 0;
  let lastTime = null;
  let timeOffset = 0;

  for (const region of regions) {
    const range = trackIndex === 0 ? region.track1Range : region.track2Range;
    const originalDistance = trackIndex === 0 ? region.track1Distance : region.track2Distance;
    const scaleFactor = originalDistance > 0 ? region.harmonizedDistance / originalDistance : 1;

    const segmentStartDistance = track[range[0]].distance;

    // Accumulate time spent in non-matching gaps between segments.
    // Use range[0]-1 (the last non-matching point) rather than range[0]
    // to preserve one natural inter-point interval at the boundary.
    if (lastTime !== null) {
      const gap = track[range[0] - 1].time - lastTime;
      timeOffset += gap;
    }

    for (let i = range[0]; i <= range[1]; i++) {
      const point = track[i];
      const distanceInSegment = point.distance - segmentStartDistance;
      const scaledDistance = distanceInSegment * scaleFactor;

      result.push({
        ...point,
        time: point.time - timeOffset,
        distance: cumulativeHarmonizedDistance + scaledDistance,
        normalizedDistance: cumulativeHarmonizedDistance + scaledDistance,
        originalDistance: point.distance,
        // Mark the first point of each region after the first so the map
        // renderer can draw the bridge to the previous region as a gap.
        gapBefore: i === range[0] && result.length > 0
      });
    }

    lastTime = track[range[1]].time;
    cumulativeHarmonizedDistance += region.harmonizedDistance;
  }

  return result;
}

/**
 * Harmonize a full track, scaling overlapping regions to average distances.
 */
function harmonizeFullTrack(track, regions, trackIndex) {
  const result = [];
  let lastProcessedIndex = 0;
  let distanceOffset = 0;

  for (const region of regions) {
    const range = trackIndex === 0 ? region.track1Range : region.track2Range;
    const originalDistance = trackIndex === 0 ? region.track1Distance : region.track2Distance;
    const scaleFactor = originalDistance > 0 ? region.harmonizedDistance / originalDistance : 1;

    // Add non-overlapping points before this region (unscaled)
    for (let i = lastProcessedIndex; i < range[0]; i++) {
      const point = track[i];
      result.push({
        ...point,
        distance: point.distance + distanceOffset,
        normalizedDistance: point.distance + distanceOffset,
        originalDistance: point.distance
      });
    }

    // Add overlapping region points (scaled)
    const segmentStartDistance = track[range[0]].distance;
    for (let i = range[0]; i <= range[1]; i++) {
      const point = track[i];
      const distanceInSegment = point.distance - segmentStartDistance;
      const scaledDistance = segmentStartDistance + distanceOffset + (distanceInSegment * scaleFactor);

      result.push({
        ...point,
        distance: scaledDistance,
        normalizedDistance: scaledDistance,
        originalDistance: point.distance
      });
    }

    // Update offset for next region
    const segmentEndOriginal = track[range[1]].distance;
    const segmentEndScaled = segmentStartDistance + distanceOffset + (region.harmonizedDistance);
    distanceOffset = segmentEndScaled - segmentEndOriginal;

    lastProcessedIndex = range[1] + 1;
  }

  // Add remaining points after last region
  for (let i = lastProcessedIndex; i < track.length; i++) {
    const point = track[i];
    result.push({
      ...point,
      distance: point.distance + distanceOffset,
      normalizedDistance: point.distance + distanceOffset,
      originalDistance: point.distance
    });
  }

  return result;
}

/**
 * Get alignment summary for display purposes.
 */
function getAlignmentSummary(alignment) {
  if (!alignment) {
    return 'No alignment found';
  }

  const { overlappingRegions, hasMultipleSegments, totalHarmonizedDistance } = alignment;

  const segments = overlappingRegions.length;
  const distanceKm = (totalHarmonizedDistance / 1000).toFixed(2);

  if (hasMultipleSegments) {
    return `${segments} overlapping segments (${distanceKm} km total)`;
  } else {
    return `Fully aligned (${distanceKm} km)`;
  }
}

/**
 * Intersect track[0] overlap ranges across all pairwise alignments to find a
 * single common overlap window for N > 2 tracks.
 *
 * For each pairwise alignment (track[0] vs track[i+1]), computes the span of
 * track[0] indices covered by any overlapping region in that pair. Then
 * intersects those spans across all pairs. For the comparison tracks, finds
 * the corresponding range by looking at which regions fall within the
 * intersected track[0] window.
 *
 * @param {AlignmentResult[]} pairwiseAlignments - One per comparison track
 * @param {number} minSegmentPoints - Minimum points for a valid intersection
 * @returns {{ track1Range: number[], perTrackRanges: number[][] } | null}
 */
function intersectOverlapRanges(pairwiseAlignments, minSegmentPoints = 3) {
  // Compute the span of track[0] indices for each pairwise alignment.
  const spans = pairwiseAlignments.map(pa => {
    const regions = pa.overlappingRegions;
    return {
      start: Math.min(...regions.map(r => r.track1Range[0])),
      end: Math.max(...regions.map(r => r.track1Range[1]))
    };
  });

  // Intersect all track[0] spans.
  const intersectStart = Math.max(...spans.map(s => s.start));
  const intersectEnd = Math.min(...spans.map(s => s.end));

  if (intersectStart >= intersectEnd || intersectEnd - intersectStart < minSegmentPoints) {
    return null;
  }

  // For each comparison track, find the track2 range that corresponds to the
  // intersected track[0] window by looking at regions that overlap with it.
  const perTrackRanges = pairwiseAlignments.map(pa => {
    const overlapping = pa.overlappingRegions.filter(r =>
      r.track1Range[0] <= intersectEnd && r.track1Range[1] >= intersectStart
    );
    if (overlapping.length === 0) return null;
    return [
      Math.min(...overlapping.map(r => r.track2Range[0])),
      Math.max(...overlapping.map(r => r.track2Range[1]))
    ];
  });

  if (perTrackRanges.some(r => r === null)) return null;

  return {
    track1Range: [intersectStart, intersectEnd],
    perTrackRanges
  };
}

/**
 * Create harmonized tracks for N > 2 tracks using a common overlap region.
 * Slices each track to its overlap window and normalizes distances against
 * track[0]'s window length.
 *
 * @param {Object[][]} tracks - Array of tracks (already cloned)
 * @param {Object} alignment - N-track alignment with hasCommonOverlap and commonOverlap
 * @returns {Object[][]} Array of harmonized tracks, one per input track
 */
function createHarmonizedTracksN(tracks, alignment) {
  if (!alignment || !alignment.hasCommonOverlap || !alignment.commonOverlap) {
    return tracks;
  }

  const { track1Range, perTrackRanges } = alignment.commonOverlap;

  // Reference: track[0]'s window distance.
  const refStartDist = tracks[0][track1Range[0]].distance;
  const refEndDist = tracks[0][track1Range[1]].distance;
  const refDistance = refEndDist - refStartDist;

  const result = [];

  // Slice track[0] to its window; normalize so distances start at 0.
  const sliced0 = [];
  for (let i = track1Range[0]; i <= track1Range[1]; i++) {
    const point = tracks[0][i];
    sliced0.push({
      ...point,
      normalizedDistance: point.distance - refStartDist
    });
  }
  result.push(sliced0);

  // Slice each comparison track to its corresponding window, scaled to match
  // track[0]'s reference distance.
  for (let ci = 0; ci < perTrackRanges.length; ci++) {
    const range = perTrackRanges[ci];
    const track = tracks[ci + 1];
    const tStartDist = track[range[0]].distance;
    const tEndDist = track[range[1]].distance;
    const tDistance = tEndDist - tStartDist;
    const scaleFactor = tDistance > 0 ? refDistance / tDistance : 1;

    const sliced = [];
    for (let i = range[0]; i <= range[1]; i++) {
      const point = track[i];
      const distInSegment = point.distance - tStartDist;
      sliced.push({
        ...point,
        normalizedDistance: distInSegment * scaleFactor
      });
    }
    result.push(sliced);
  }

  return result;
}
