let minTime = Infinity;
let maxTime = -Infinity;

let tracks = [];
let markers = [];

function createLegend() {
  const legendContainer = document.getElementById("legend-container");
  clearChildren(legendContainer);
  for (let i in tracks) {
    const track = tracks[i];

    const legendLine = document.getElementById("legend-line");
    const clone = legendLine.content.cloneNode(true);
    clone.querySelector("#legend-text").textContent =
      `Date: ${getStartDate(track)}`;
    clone.querySelector("#legend-icon").style.backgroundColor = getColor(i);
    let trackId = i;

    clone.querySelector(".delete-button").addEventListener("click", (e) => {
      tracks.splice(trackId, 1);
      updateTracks();
    });

    legendContainer.appendChild(clone);
  }

  legendContainer.style.top = "10px";
  legendContainer.style.right = "10px";
  legendContainer.style.backgroundColor = "white";
  legendContainer.style.padding = "10px";
  legendContainer.style.border = "1px solid #ccc";
}

function initializeSlider() {
  const slider = document.getElementById("time-slider");
  slider.min = minTime;
  slider.max = maxTime;
  slider.value = minTime;
  slider.step = 1; // 1 second steps

  slider.addEventListener("input", updateMarkers);
  updateMarkers(); // Call updateMarkers() immediately after initialization
}

function updateMarkers() {
  const slider = document.getElementById("time-slider");
  const currentTime = parseInt(slider.value);

  for (let i in tracks) {
    let track = tracks[i];
    const position = getPositionAtTime(track, currentTime);
    const color = getColor(i);
    if (position) {
      if (!markers[i]) {
        markers[i] = L.marker([position.lat, position.lon], {
          icon: L.divIcon({
            className: "my-div-icon",
            html: `<div style="background-color: ${color}; width: 10px; height: 10px; border-radius: 5px;"></div>`,
          }),
        }).addTo(markerGroup);
      } else {
        markers[i].setLatLng([position.lat, position.lon]);
      }
    }
  }
  drawGraphs(currentTime);
}

function updateTracks() {
  // Clean up.
  markerGroup.clearLayers();
  removeGraphs();

  normalizeTracks(tracks);

  for (i in tracks) {
    const track = tracks[i];

    minTime = Math.min(track[0].time, minTime);
    maxTime = Math.max(track[track.length - 1].time, maxTime);

    const latlngs = track.map((point) => [point.lat, point.lon]);
    const polyline = L.polyline(latlngs, {
      color: getColor(i),
    }).addTo(markerGroup);
    map.fitBounds(polyline.getBounds()); // Zoom to the track
  }
  createLegend();
  initializeSlider();
}

function removeGraphs() {
  const graphContainer = document.getElementById("graph");
  while (graphContainer.children.length) {
    graphContainer.removeChild(graphContainer.children[0]);
  }
}

function drawGraphs(currentTime) {
  removeGraphs();
  let type = document.querySelector("#compare-by-menu").value;

  drawElevationGraph(currentTime);

  if (type === "time") {
    drawDifferenceGraph(
      currentTime,
      "normalizedDistance",
      "time",
      "Time Behind (s)",
    );
  } else if (type === "distance") {
    drawDifferenceGraph(
      currentTime,
      "time",
      "normalizedDistance",
      "Distance Behind (m)",
      (v) => -1 * v,
    );
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
  const graphStart = minTime;
  const graphEnd = tracks.reduce(
    (a, c) => Math.min(a, c[c.length - 1].time),
    Infinity,
  );
  let comparisonTracks = tracks.slice(1);

  for (let t = graphStart; t <= graphEnd; t += 1) {
    const baseline = tracks[0][t][y_name];
    const x_value =
      x_name === "time" ? t : getValueAtPosition(tracks[0], "time", t, x_name);

    comparisonTracks.map((track) => {
      const comparator = getValueAtPosition(track, x_name, x_value, y_name);
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

  let marks = [
    Plot.line(tracks[0], {
      x: "normalizedDistance",
      y: "elevation",
    }),
  ];

  let dots = [];

  tracks.forEach((track) => {
    // First get the distance on this track.
    const distance = getValueAtPosition(
      track,
      "time",
      currentTime,
      "normalizedDistance",
    );

    // Now get the elevation on track[0];
    const elevation = getValueAtPosition(
      tracks[0],
      "distance",
      distance,
      "elevation",
    );
    dots.push({ x: distance, y: elevation });
  });

  marks.push(
    Plot.dot(dots, {
      x: "x",
      y: "y",
      fill: "red",
    }),
  );

  const chart = Plot.plot({
    width: graphContainer.clientWidth,
    marks: marks,
    x: {
      type: "linear",
      label: "Distance (km)",
    },
    y: {
      label: "Elevation (ft)",
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

function addFileListener(name) {
  const fileInput = document.getElementById(name);
  fileInput.style.opacity = 0;
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];

    if (file) {
      const reader = new FileReader();
      console.log(file);
      reader.onload = (e) => {
        const track = parseGPX(e.target.result);
        tracks.push(track);
        updateTracks();
      };
      reader.readAsText(file);
    }
  });
}

// Function to fetch and display a GPX track
function fetchGPXTrack(url) {
  fetch(url)
    .then((response) => response.text())
    .then((gpxData) => {
      const track = parseGPX(gpxData);
      tracks.push(track);
      updateTracks();
    })
    .catch((error) => console.error("Error loading GPX:", error));
}

let map = undefined;
let markerGroup = undefined;

document.addEventListener("DOMContentLoaded", () => {
  // Initialize Leaflet map
  map = L.map("map").setView([0, 0], 2); // Set initial view to a very zoomed out view.

  // Add a tile layer (OpenStreetMap)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  markerGroup = L.featureGroup().addTo(map);

  // Set up the deploy date.
  fetch("deploy-date.txt")
    .then((response) => response.text())
    .then((v) => (document.querySelector("#deploy-date").textContent = v));

  // Check to see if we are in test mode.
  const url = new URL(window.location);
  console.log(url);
  if (url.hash == "#test") {
    console.log("Test mode");
    fetchGPXTrack("track1.gpx");
    fetchGPXTrack("track2.gpx");
  }

  addFileListener("track");
  addGraphTypeListener();
});
