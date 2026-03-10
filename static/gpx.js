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
  const date = startDate.toDateString();
  const time = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

function getPositionAtTime(track, time) {
  if (!track || track.length < 2) {
    return null; // Handle empty or single-point tracks
  }

  // Use displayTime if available (for harmonized overlapping regions)
  const getTime = (point) => point.displayTime !== undefined ? point.displayTime : point.time;

  if (time <= getTime(track[0])) {
    return track[0];
  }

  if (time >= getTime(track[track.length - 1])) {
    return track[track.length - 1];
  }

  for (let i = 1; i < track.length; i++) {
    if (getTime(track[i]) >= time) {
      const t1 = getTime(track[i - 1]);
      const t2 = getTime(track[i]);

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

function getDistanceFromPointInKm(p1, p2) {
  return getDistanceFromLatLonInKm(p1.lat, p1.lon, p2.lat, p2.lon);
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

function findMatchingSegments(track1, track2, threshold = 0.03) {
  let segments = [];
  const window = 30;
  let t1Index = 0;
  let t2Index = 0;

  // First set up. Tracks had better start in the same place.
  let distance = getDistanceFromPointInKm(track1[0], track2[0]);
  if (distance > threshold) {
    console.error("Initial points too far apart");
    return null;
  }
  let currentSegment = [0, 0];
  let matching = true;

  for (; t1Index < track1.length; t1Index++) {
    //console.log(`Matching = ${matching} T1=${t1Index} T2=${t2Index}`);
    if (matching) {
      // We are in a matching segment.
      // Find the closest point on track2 that is >= the current position
      // within window `window`
      distance = getDistanceFromPointInKm(track1[t1Index], track2[t2Index]);
      /*console.log(
        `T1=${t1Index} T2=${t2Index} distance=${distance} cum1=${track2[t1Index].distance} cum2=${track2[t2Index].distance}`,
      );*/
      for (
        let i = t2Index;
        i < Math.min(track2.length, t2Index + window);
        i++
      ) {
        const d = getDistanceFromPointInKm(track1[t1Index], track2[i]);
        if (d < distance) {
          t2Index = i;
          distance = d;
        }
      }

      // OK, we now have the closest point on t2. Check to see if it's
      // in the window.
      if (distance > threshold) {
        console.log(
          `Track 1 and track 2 diverged at t1=${t1Index} t2=${t2Index}`,
        );
        matching = false;
        segments.push([
          [currentSegment[0], t1Index],
          [currentSegment[1], t2Index],
        ]);
      }
    } else {
      // We don't have a match.
      // Step forward on t2 to see if there is any future point that
      // is within the threshold of the current point on t1.
      for (let i = t2Index; i < track2.length; i++) {
        const d = getDistanceFromPointInKm(track1[t1Index], track2[i]);

        if (d < threshold) {
          t2Index = i;
          console.log(
            `Track 1 and track 2 converged at t1=${t1Index} t2=${t2Index}`,
          );
          matching = true;
          currentSegment = [t1Index, i];
          break;
        }
      }
    }
  }

  // There are no more points in track1, but there might be some more points in
  // track2, so iterate through the rest. If this is still a segment, they
  // should all be within threshold.
  if (matching) {
    while (t2Index < track2.length - 1) {
      const d = getDistanceFromPointInKm(
        track1[track1.length - 1],
        track2[t2Index],
      );
      if (d > threshold) {
        console.log(
          `Track 1 and track 2 diverged at t1=${t1Index} t2=${t2Index}`,
        );
        break;
      }
      t2Index++;
    }

    // OK, we now have the last point in t2
    segments.push([
      [currentSegment[0], t1Index],
      [currentSegment[1], t2Index],
    ]);
  }

  console.log(segments);
  return segments;
}

function consolidateSegments(tracks, segments) {
  let newtracks = [];

  tracks.forEach((track, i) => {
    let newtrack = [];

    segments.forEach((segment_group) => {
      const segment_indexes = segment_group[i];
      const segment = track.slice(segment_indexes[0], segment_indexes[1] + 1);
      let time_offset;

      // We need to adjust time to make segments
      // contiguous.
      if (newtrack.length === 0) {
        // If this is the first segment, then
        // we align the first point at t=0, distance=0
        time_offset = segment[0].time;
      } else {
        // If this is not the first segment, then we have to cheat a
        // little bit. We take the gap between the first two points in
        // this segment and adjust so that the gap between the last
        // segment and this segment matches that.
        if (segment.length < 2) {
          throw new Error("Short segment");
        }
        time_offset =
          segment[0].time -
          newtrack[newtrack.length - 1].time -
          (segment[1].time - segment[0].time);
      }

      newtrack.push(
        ...segment.map((s) => {
          s.time -= time_offset;
          return s;
        }),
      );
    });

    // Now recompute all the distances.
    let cumulativeDistance = 0;
    for (index in newtrack) {
      if (index > 0) {
        const distance =
          getDistanceFromLatLonInKm(
            newtrack[index - 1].lat,
            newtrack[index - 1].lon,
            newtrack[index].lat,
            newtrack[index].lon,
          ) * 1000; // Convert to meters
        if (distance > 1000) {
          console.log("Too long");
        }
        cumulativeDistance += distance;
        newtrack[index].distance = cumulativeDistance;
      }
    }

    newtracks.push(newtrack);
  });

  return newtracks;
}

// Adjust the track to start contiguously with the
// current_distance. There are two cases:
//
// 1. current_distance is 0, in which case no
//    adjustment is needed.
// 2. current_distance is nonzero, in which case
//    we set track[0] to be right after the
//    current_distance, specifically the distance
//    between track[0] and track[1].
function adjustTrackDistance(track, current_distance) {
  if (!current_distance) {
    return track;
  }

  const distance_offset =
    track[0].distance -
    current_distance -
    (track[1].distance - track[0].distance);

  return track.map((point) => {
    return {
      distance: point.distance - distance_offset,
      normalizedDistance: point.distance - distance_offset,
      ...point,
    };
  });
}

// Recompute the distance for a track using the
// given start value.
function computeDistanceForTrack(track, start = 0) {
  // Now recompute all the distances.
  let cumulativeDistance = start;

  for (let index in track) {
    if (index > 0) {
      const distance =
        getDistanceFromLatLonInKm(
          track[index - 1].lat,
          track[index - 1].lon,
          track[index].lat,
          track[index].lon,
        ) * 1000; // Convert to meters
      if (distance > 1000) {
        console.log("Too long");
      }
      cumulativeDistance += distance;
      track[index].distance = cumulativeDistance;
    }
  }

  return track;
}
