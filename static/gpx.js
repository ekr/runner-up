function parseGPX(gpxData) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(gpxData, "text/xml");
  const points = xmlDoc.querySelectorAll("trkpt");
  let track = [];

  if (points.length === 0) {
    return track; // Return empty track if no points
  }
  const startTime = new Date(points[0].querySelector("time").textContent);
  const startTimeMilliseconds = startTime.getTime();
  let cumulativeDistance = 0;

  points.forEach((point, index) => {
    const lat = parseFloat(point.getAttribute("lat"));
    const lon = parseFloat(point.getAttribute("lon"));
    const ele = parseFloat(point.querySelector("ele").textContent);
    const absoluteTime = new Date(point.querySelector("time").textContent);
    const relativeTime = absoluteTime.getTime() - startTimeMilliseconds; // Time since start

    if (index > 0) {
      cumulativeDistance +=
        getDistanceFromLatLonInKm(
          track[index - 1].lat,
          track[index - 1].lon,
          lat,
          lon,
        ) * 1000; // Convert to meters
    }

    track.push({
      lat,
      lon,
      elevation: ele,
      time: relativeTime / 1000,
      absoluteTime: absoluteTime / 1000,
      distance: cumulativeDistance,
    });
  });

  return track;
}

function getStartDate(track) {
  const startDate = new Date(track[0].absoluteTime * 1000);
  return startDate.toDateString();
}

function getPositionAtTime(track, time) {
  if (!track || track.length < 2) {
    return null; // Handle empty or single-point tracks
  }

  if (time <= track[0].time) {
    return track[0];
  }

  if (time >= track[track.length - 1].time) {
    return track[track.length - 1];
  }

  for (let i = 1; i < track.length; i++) {
    if (track[i].time >= time) {
      const t1 = track[i - 1].time;
      const t2 = track[i].time;

      if (t1 === t2) {
        return track[i]; // Handle cases where timestamps are the same
      }

      const ratio = (time - t1) / (t2 - t1);

      const lat = track[i - 1].lat + (track[i].lat - track[i - 1].lat) * ratio;
      const lon = track[i - 1].lon + (track[i].lon - track[i - 1].lon) * ratio;

      return { lat, lon };
    }
  }

  return null; // Should not reach here
}

// Helper function to get distance at a specific time
function getDistanceAtTime(track, time) {
  for (let i = 1; i < track.length; i++) {
    if (track[i].time >= time) {
      // Interpolate distance
      const ratio =
        (time - track[i - 1].time) / (track[i].time - track[i - 1].time);
      return (
        track[i - 1].distance +
        (track[i].distance - track[i - 1].distance) * ratio
      );
    }
  }
  return 0; // Default to 0 if time is before the first point
}

// Helper function to get normalized distance at a specific time
function getNormalizedDistanceAtTime(track, time) {
  for (let i = 1; i < track.length; i++) {
    if (track[i].time >= time) {
      // Interpolate distance
      const ratio =
        (time - track[i - 1].time) / (track[i].time - track[i - 1].time);
      return (
        track[i - 1].normalizedDistance +
        (track[i].normalizedDistance - track[i - 1].normalizedDistance) * ratio
      );
    }
  }
  return 0; // Default to 0 if time is before the first point
}

// Thanks, Gemini.
/**
 * Linearly interpolates a value using an ESTIMATION + LOCAL SEARCH strategy
 * to find bracketing points. Assumes monotonically increasing positions.
 *
 * @param {Array<Object>} track - The array of data objects.
 * @param {string} positionField - Field name for position.
 * @param {number} targetPosition - The position to interpolate at.
 * @param {string} valueField - Field name for the value.
 * @returns {number | null} Interpolated value or null.
 */
function getValueAtPosition(track, positionField, targetPosition, valueField) {
  // --- Input Validation and Edge Cases (O(1)) ---
  if (!track || track.length === 0) {
    console.warn("Interpolation track is empty or invalid.");
    return null;
  }
  const firstEntry = track[0];
  const lastEntry = track[track.length - 1];
  const minPos = firstEntry[positionField];
  const maxPos = lastEntry[positionField];

  if (targetPosition <= minPos) {
    return firstEntry[valueField];
  }
  if (targetPosition >= maxPos) {
    return lastEntry[valueField];
  }

  // --- Optimized Search for Bracketing Indices ---

  let lowerIndex = 0;
  let upperIndex = track.length - 1;

  // Handle case where all positions are the same (and targetPosition matches)
  if (maxPos === minPos) {
    // Since targetPosition is > minPos and < maxPos is impossible here,
    // this case shouldn't be reached due to edge checks above.
    // But if it were possible, return the value.
    return firstEntry[valueField];
  }

  // Estimate starting index based on relative position
  const relativePos = (targetPosition - minPos) / (maxPos - minPos);
  // Ensure estimated index is within bounds [0, track.length - 1]
  let currentIndex = Math.max(
    0,
    Math.min(track.length - 1, Math.floor(relativePos * (track.length - 1))),
  );

  // If we got lucky, return the exact value.
  if (track[currentIndex][positionField] === targetPosition) {
    return track[currentIndex][valueField];
  }

  // Search outwards from the estimated index
  if (track[currentIndex][positionField] < targetPosition) {
    // Target is likely AFTER currentIndex. Search FORWARD.
    lowerIndex = currentIndex; // Current is a potential lower bound
    // Start searching from the next element
    for (let i = currentIndex + 1; i < track.length; i++) {
      if (track[i][positionField] >= targetPosition) {
        upperIndex = i; // Found the upper bound
        break;
      }
      lowerIndex = i; // Update lower bound as we go
    }
    // If loop finishes, upperIndex remains track.length - 1 (covered by edge case)
  } else {
    // track[currentIndex][positionField] > targetPosition
    // Target is likely BEFORE currentIndex. Search BACKWARD.
    upperIndex = currentIndex; // Current is a potential upper bound
    // Start searching from the previous element
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (track[i][positionField] < targetPosition) {
        lowerIndex = i; // Found the lower bound
        break;
      }
      upperIndex = i; // Update upper bound as we go
    }
    // If loop finishes, lowerIndex remains 0 (covered by edge case)
  }

  // --- Perform Linear Interpolation (Same logic as before) ---
  const lowerEntry = track[lowerIndex];
  const upperEntry = track[upperIndex];

  const pos0 = lowerEntry[positionField];
  const val0 = lowerEntry[valueField];
  const pos1 = upperEntry[positionField];
  const val1 = upperEntry[valueField];

  if (pos1 === pos0) {
    // Handles exact match on duplicate positions or potential data issues
    return val0; // Or val1, or average ((val0 + val1) / 2)
  }

  const factor = (targetPosition - pos0) / (pos1 - pos0);
  const interpolatedValue = val0 + factor * (val1 - val0);

  return interpolatedValue;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  // Haversine formula (calculates distance between two GPS coordinates)
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function getTimeAtNormalizedDistance(track, distance) {
  for (let i = 1; i < track.length; i++) {
    if (track[i].normalizedDistance >= distance) {
      // Interpolate distance
      const ratio =
        (distance - track[i - 1].normalizedDistance) /
        (track[i].normalizedDistance - track[i - 1].normalizedDistance);
      return track[i - 1].time + (track[i].time - track[i - 1].time) * ratio;
    }
  }
  return 0; // Default to 0 if distance is before the first point
}

function findClosestTimeToPosition(
  track,
  otherTime,
  otherDistance,
  otherPoint,
) {
  const currentDistance = getDistanceAtTime(track, otherTime);
  const step = currentDistance > otherDistance ? -1 : 1;
  let index;

  // Find the starting index.
  for (index = 0; index < track.length; index++) {
    if (track[index].time >= otherTime) {
      break;
    }
  }
  if (index == track.length) {
    // TODO: Fix this.
    return undefined;
  }

  let bestDistance = Infinity;
  // Now scrub in the right direction.
  while (index > 0 && index < track.length) {
    const distance = getDistanceFromLatLonInKm(
      otherPoint.lat,
      otherPoint.lon,
      track[index].lat,
      track[index].lon,
    );
    if (distance > bestDistance) {
      return track[index].time;
    }
    bestDistance = distance;
    index += step;
  }

  return undefined;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Provide a normalized distance under the assumption that the
// tracks are actually the same length. Rescales everything
// to be the mean of the track length.
function normalizeTracks(tracks) {
  const mean_length = tracks.reduce(
    (prev, current) =>
      prev + current[current.length - 1].distance / tracks.length,
    0,
  );

  tracks.forEach((track) => {
    const ratio = track[track.length - 1].distance / mean_length;
    track.forEach((point) => {
      point.normalizedDistance = point.distance / ratio;
    });
  });
}
