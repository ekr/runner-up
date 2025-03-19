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

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}
