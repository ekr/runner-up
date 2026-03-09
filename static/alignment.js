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
function findOverlappingRegions(track1, track2, options = {}) {
  const {
    threshold = 0.03,  // 30 meters
    searchWindow = 30,
    minSegmentPoints = 3
  } = options;

  if (!track1?.length || !track2?.length) {
    return null;
  }

  const regions = [];
  let t1Index = 0;
  let t2Index = 0;
  let currentRegion = null;
  let matching = false;

  // Check if tracks start in the same place
  const initialDistance = getDistanceFromPointInKm(track1[0], track2[0]);
  if (initialDistance > threshold) {
    // Tracks don't start at the same point - try to find where they first intersect
    const intersection = findFirstIntersection(track1, track2, threshold, searchWindow);
    if (!intersection) {
      console.warn('Tracks do not intersect within search window');
      return null;
    }
    t1Index = intersection.t1Index;
    t2Index = intersection.t2Index;
  }

  // Start first matching region
  currentRegion = {
    track1Start: t1Index,
    track2Start: t2Index
  };
  matching = true;

  while (t1Index < track1.length) {
    if (matching) {
      // We're in a matching segment - find closest point on track2
      const result = findClosestPointInWindow(
        track1[t1Index],
        track2,
        t2Index,
        searchWindow,
        threshold
      );

      if (result.found) {
        t2Index = result.index;
        t1Index++;
      } else {
        // Tracks diverged
        console.log(`Tracks diverged at t1=${t1Index}, t2=${t2Index}`);

        // Close current region if it has enough points
        const regionLength = t1Index - currentRegion.track1Start;
        if (regionLength >= minSegmentPoints) {
          regions.push(createRegion(
            track1, track2,
            currentRegion.track1Start, t1Index - 1,
            currentRegion.track2Start, t2Index
          ));
        }

        matching = false;
        t1Index++;
      }
    } else {
      // Not matching - search for reconvergence
      const reconvergence = findReconvergence(
        track1, track2,
        t1Index, t2Index,
        threshold
      );

      if (reconvergence) {
        console.log(`Tracks reconverged at t1=${reconvergence.t1Index}, t2=${reconvergence.t2Index}`);
        t1Index = reconvergence.t1Index;
        t2Index = reconvergence.t2Index;
        currentRegion = {
          track1Start: t1Index,
          track2Start: t2Index
        };
        matching = true;
      } else {
        // No reconvergence found, move to next point
        t1Index++;
      }
    }
  }

  // Close final region if we ended while matching
  if (matching && currentRegion) {
    const regionLength = track1.length - 1 - currentRegion.track1Start;
    if (regionLength >= minSegmentPoints) {
      // Find the corresponding end in track2
      let t2End = t2Index;
      // Extend t2End to include any remaining close points
      while (t2End < track2.length - 1) {
        const d = getDistanceFromPointInKm(track1[track1.length - 1], track2[t2End + 1]);
        if (d <= threshold) {
          t2End++;
        } else {
          break;
        }
      }

      regions.push(createRegion(
        track1, track2,
        currentRegion.track1Start, track1.length - 1,
        currentRegion.track2Start, t2End
      ));
    }
  }

  if (regions.length === 0) {
    return null;
  }

  // Calculate total harmonized distance
  const totalHarmonized = regions.reduce((sum, r) => sum + r.harmonizedDistance, 0);

  return {
    overlappingRegions: regions,
    hasMultipleSegments: regions.length > 1,
    totalHarmonizedDistance: totalHarmonized
  };
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
 * Find the closest point in track within a window of the current index.
 */
function findClosestPointInWindow(point, track, startIndex, windowSize, threshold) {
  let bestIndex = startIndex;
  let bestDistance = Infinity;

  const endIndex = Math.min(track.length, startIndex + windowSize);

  for (let i = startIndex; i < endIndex; i++) {
    const d = getDistanceFromPointInKm(point, track[i]);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  return {
    found: bestDistance <= threshold,
    index: bestIndex,
    distance: bestDistance
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
  let lastTime = 0;

  for (const region of regions) {
    const range = trackIndex === 0 ? region.track1Range : region.track2Range;
    const originalDistance = trackIndex === 0 ? region.track1Distance : region.track2Distance;
    const scaleFactor = originalDistance > 0 ? region.harmonizedDistance / originalDistance : 1;

    const segmentStart = track[range[0]];
    const segmentStartDistance = segmentStart.distance;

    // Add gap between segments if not first
    if (result.length > 0) {
      // Use time gap from the track as a guide
      const timeGap = Math.max(1, track[range[0]].time - lastTime);
      lastTime = track[range[0]].time;
    }

    for (let i = range[0]; i <= range[1]; i++) {
      const point = track[i];
      const distanceInSegment = point.distance - segmentStartDistance;
      const scaledDistance = distanceInSegment * scaleFactor;

      result.push({
        ...point,
        distance: cumulativeHarmonizedDistance + scaledDistance,
        normalizedDistance: cumulativeHarmonizedDistance + scaledDistance,
        originalDistance: point.distance
      });

      lastTime = point.time;
    }

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
