function removeGraphs() {
  const graphContainer = document.getElementById("graph");
  while (graphContainer.children.length) {
    graphContainer.removeChild(graphContainer.children[0]);
  }
}

function drawGraphs(currentTime, all_match) {
  removeGraphs();
  let type = document.querySelector("#compare-by-menu").value;

  drawElevationGraph(currentTime, all_match);

  if (all_match) {
    if (type === "time") {
      drawDifferenceGraph(
        currentTime,
        "displayDistance",
        "time",
        "Time Behind (s)",
      );
    } else if (type === "distance") {
      drawDifferenceGraph(
        currentTime,
        "time",
        "displayDistance",
        `Distance Behind (${Units().distanceDiffUnits()})`,
        (v) => Units().distanceDiffValue(-1 * v),
      );
    }
  }
}

function drawDifferenceGraph(
  currentTime,
  x_name,
  y_name,
  y_label,
  transform = (v) => v,
) {
  if (tracks.length < 2) {
    return;
  }

  const leader = tracks[0];
  const leaderMaxDist = leader[leader.length - 1].displayDistance;
  const comparisonTracks = tracks.slice(1);
  const differences = [];

  for (let ci = 0; ci < comparisonTracks.length; ci++) {
    const comp = comparisonTracks[ci];
    const compEnd = comp[comp.length - 1].time;
    const trackLabel = getTrackDisplayName(ci + 1);

    for (let t = minTime; t <= compEnd; t += 1) {
      let diff;
      if (y_name === "time") {
        // Follower-anchored: how long ago did the leader pass the comp's current position.
        const d_comp = getValueAtPosition(comp, "time", t, "displayDistance");
        if (d_comp == null || isNaN(d_comp)) continue;
        if (d_comp > leaderMaxDist) continue;
        const tLeaderAtDComp = getValueAtPosition(leader, "displayDistance", d_comp, "time");
        if (tLeaderAtDComp == null || isNaN(tLeaderAtDComp)) continue;
        diff = transform(t) - transform(tLeaderAtDComp);
      } else {
        const x_value = x_name === "time" ? t : getValueAtPosition(leader, "time", t, x_name);
        const baseline = getValueAtPosition(leader, "time", t, y_name);
        const comparator = getValueAtPosition(comp, x_name, x_value, y_name);
        if (baseline == null || comparator == null) continue;
        diff = transform(comparator) - transform(baseline);
      }
      differences.push({ time: t, diff, trackLabel });
    }
  }

  const graphContainer = document.getElementById("graph");

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: [
      Plot.line(differences, {
        x: "time",
        y: "diff",
        stroke: (d) => d.trackLabel,
      }),
      Plot.ruleX([currentTime], { stroke: "red" }),
    ],
    x: {
      type: "linear",
      label: "Time (s)",
      domain: [minTime, maxTime],
    },
    y: {
      label: y_label,
    },
  });

  graphContainer.appendChild(chart);
}

function drawElevationGraph(currentTime) {
  const graphContainer = document.getElementById("graph");
  if (tracks.length < 1) {
    return;
  }

  // We always plot track[0]
  let marks = [
    Plot.line(tracks[0], {
      x: (d) => Units().distanceValue(d.displayDistance),
      y: (d) => Units().elevationValue(d.elevation),
      stroke: all_match ? "black" : getColor(0),
    }),
  ];

  if (!all_match) {
    for (let i = 1; i < tracks.length; i++) {
      marks.push(
        Plot.line(tracks[i], {
          x: (d) => Units().distanceValue(d.displayDistance),
          y: (d) => Units().elevationValue(d.elevation),
          stroke: getColor(i),
        }),
      );
    }
  }

  let dots = [];

  tracks.forEach((track, index) => {
    // First get the distance on this track.
    const distance = getValueAtPosition(
      track,
      "time",
      currentTime,
      "displayDistance",
    );

    // Now get the elevation on track[0];
    const elevation = getValueAtPosition(
      all_match ? tracks[0] : tracks[index],
      "displayDistance",
      distance,
      "elevation",
    );
    const username = (typeof shouldShowAvatars === 'function' && shouldShowAvatars()) ? (dataToSharedBy[index] || null) : null;
    dots.push({
      x: Units().distanceValue(distance),
      y: Units().elevationValue(elevation),
      color: getColor(index),
      username: username,
    });
  });

  // Kick off avatar loads for any new usernames; split into avatar vs plain dots.
  const avatarDots = [];
  const plainDots = [];
  for (const dot of dots) {
    if (dot.username && typeof loadAvatarIfNeeded === 'function') {
      loadAvatarIfNeeded(dot.username);
    }
    if (dot.username && typeof avatarCache !== 'undefined' && avatarCache[dot.username]) {
      dot.src = avatarUrl(dot.username);
      avatarDots.push(dot);
    } else {
      plainDots.push(dot);
    }
  }
  // Colored dots: larger for avatar-backed dots (serves as colored border).
  marks.push(
    Plot.dot(dots, {
      x: "x",
      y: "y",
      fill: (d) => d.color,
      r: (d) => avatarDots.includes(d) ? 12 : 6,
    }),
  );

  // Overlay avatar images on dots that have them.
  if (avatarDots.length > 0) {
    marks.push(
      Plot.image(avatarDots, {
        x: "x",
        y: "y",
        src: "src",
        r: 10,
      }),
    );
  }

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: marks,
    x: {
      type: "linear",
      label: `Distance (${Units().distanceUnits()})`,
    },
    y: {
      label: `Elevation (${Units().elevationUnits()})`,
    },
  });

  graphContainer.appendChild(chart);
}

function addGraphTypeListener() {
  document
    .querySelector("#compare-by-menu")
    .addEventListener("change", (_e) => {
      updateMarkers();
    });
}
