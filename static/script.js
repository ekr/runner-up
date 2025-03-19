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
    legendContainer.appendChild(clone);
  }

  legendContainer.style.position = "absolute";
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
        }).addTo(map);
      } else {
        markers[i].setLatLng([position.lat, position.lon]);
      }
    }
  }
  drawGraph(currentTime);
}

function updateTracks() {
  for (i in tracks) {
    const track = tracks[i];

    minTime = Math.min(track[0].time, minTime);
    maxTime = Math.max(track[track.length - 1].time, maxTime);

    const latlngs = track.map((point) => [point.lat, point.lon]);
    const polyline = L.polyline(latlngs, {
      color: getColor(i),
    }).addTo(map);
    map.fitBounds(polyline.getBounds()); // Zoom to the track
  }
  createLegend();
  initializeSlider();
}

function drawGraph(currentTime) {
  if (tracks.length < 2) {
    return;
  }

  let distanceDifferences = [];
  const graphStart = minTime;
  const graphEnd = tracks.reduce(
    (a, c) => Math.min(a, c[c.length - 1].time),
    Infinity,
  );
  let comparisonTracks = tracks.slice(1);

  for (let t = graphStart; t <= graphEnd; t += 1) {
    const baseline = getDistanceAtTime(tracks[0], t);
    comparisonTracks.map((track) => {
      const distance = getDistanceAtTime(track, t);
      const distanceDiff = distance - baseline;
      distanceDifferences.push({
        time: t,
        diff: distanceDiff,
        trackDate: getStartDate(track),
      });
    });
  }
  const chart = Plot.plot({
    marks: [
      Plot.line(distanceDifferences, {
        x: "time",
        y: "diff",
        stroke: (d) => d.trackDate,
      }),
      Plot.ruleX([currentTime], { stroke: "red" }), // Vertical bar
    ],
    x: {
      type: "linear",
      label: "Time (s)",
    },
    y: {
      label: "Distance Difference (m)",
    },
  });

  const graphContainer = document.getElementById("graph");
  while (graphContainer.children.length) {
    graphContainer.removeChild(graphContainer.children[0]);
  }
  graphContainer.appendChild(chart);
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

// Initialize Leaflet map
const map = L.map("map").setView([0, 0], 2); // Set initial view to a very zoomed out view.

// Add a tile layer (OpenStreetMap)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

addFileListener("track");
