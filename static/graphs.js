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

  let differences = [];
  // Use displayTime for graph bounds (handles harmonized overlapping regions)
  const graphStart = tracks[0][0].displayTime;
  const graphEnd = tracks.reduce(
    (a, c) => Math.min(a, c[c.length - 1].displayTime),
    Infinity,
  );
  let comparisonTracks = tracks.slice(1);

  // Iterate over actual track points instead of assuming time=index
  for (let i = 0; i < tracks[0].length; i++) {
    const point = tracks[0][i];
    const t = point.displayTime;

    // Skip points outside our graph range
    if (t < graphStart || t > graphEnd) continue;

    const baseline = point[y_name];
    const x_value =
      x_name === "time" ? t : point[x_name === "displayDistance" ? "displayDistance" : x_name];

    comparisonTracks.map((track) => {
      const comparator = getValueAtPosition(track, x_name === "time" ? "displayTime" : x_name, x_value, y_name);
      differences.push({
        time: t,
        diff: transform(comparator) - transform(baseline),
        trackDate: getStartDate(track),
      });
    });
  }

  const graphContainer = document.getElementById("graph");

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: [
      Plot.line(differences, {
        x: "time",
        y: "diff",
        stroke: (d) => d.trackDate,
      }),
      Plot.ruleX([currentTime], { stroke: "red" }), // Vertical bar
      /*
      Plot.text([{ x: currentTime, y: 0, label: "Diff" }], {
        x: "x",
        y: "y",
        text: "label",
      }),*/
    ],
    x: {
      type: "linear",
      label: "Time (s)",
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
    // First get the distance on this track (use displayTime for harmonized tracks).
    const distance = getValueAtPosition(
      track,
      "displayTime",
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
    dots.push({
      x: Units().distanceValue(distance),
      y: Units().elevationValue(elevation),
      color: getColor(index),
    });
  });

  marks.push(
    Plot.dot(dots, {
      x: "x",
      y: "y",
      fill: (d) => d.color,
      r: 6,
    }),
  );

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
