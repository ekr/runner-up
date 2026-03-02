let minTime = Infinity;
let maxTime = -Infinity;

// The raw GPX data we loaded in.
let data = [];

// The tracks to actually plot transformed into ready-to-plot
// version.
let tracks = [];

// The individual matching segments for each track.
let segments = null;

// Whether we have a single course where all the tracks line
// up, either because it was created that way or because
// we merged the matching segments.
let all_match = null;

// The map object.
let lmap = undefined;

// The data has been updated, so we need to basically
// start from scratch.
function dataUpdated() {
  if (!data.length) {
    lmap.clear();
    removeGraphs();
    return;
  }
  // TODO(ekr@rtfm.com): Handle >2 tracks.
  if (data.length > 1) {
    segments = findMatchingSegments(data[0], data[1], 0.03, 20);
  } else {
    segments = [[0, data[0].length - 1]];
  }

  const trim_tracks = document.querySelector("#trim-tracks");
  if (!segments) {
    console.log("No matching segments");
    trim_tracks.style.display = "none";
  } else if (segments.length > 1) {
    console.log("More than one segment");
    trim_tracks.style.display = "flex";
  } else {
    console.log("All segments match");
    trim_tracks.style.display = "none";
  }

  displayTracks();

  // Show/hide the file picker depending on how many tracks have
  // been loaded.
  document.querySelector("#add-track").style.display =
    data.length >= 2 ? "none" : "flex";
}

function displayTracks() {
  tracks = structuredClone(data);

  if (!segments) {
    all_match = false;
  } else if (segments.length > 1) {
    const trim_tracks = document.querySelector("#trim-tracks-checkbox");
    if (trim_tracks.checked) {
      tracks = consolidateSegments(tracks, segments);
      normalizeTracks(tracks);
      all_match = true;
    } else {
      all_match = false;
    }
  } else {
    normalizeTracks(tracks);
    all_match = true;
  }
  tracks.forEach((track) => {
    track.forEach((point) => {
      point.displayDistance = point.normalizedDistance ?? point.distance;
    });
  });

  // Clean up
  lmap.clear();
  removeGraphs();

  for (i in tracks) {
    const track = tracks[i];

    minTime = Math.min(track[0].time, minTime);
    maxTime = Math.max(track[track.length - 1].time, maxTime);

    lmap.drawTrack(track);
  }
  lmap.createLegend(tracks);
  initializeSlider();
  updateMarkers();
}

// Listen for new files to be added.
function addFileListener(name) {
  const fileInput = document.getElementById(name);
  fileInput.style.opacity = 0;
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];

    if (file) {
      const reader = new FileReader();
      console.log(file);
      reader.onload = (e) => {
        const gpxText = e.target.result;
        const track = parseGPX(gpxText);
        data.push(track);
        saveGPXToLocalStorage(file.name, gpxText);
        dataUpdated();
      };
      reader.readAsText(file);
    }
  });
}

// Create the time slider.
function initializeSlider() {
  const slider = document.getElementById("time-slider");
  slider.min = minTime;
  slider.max = maxTime;
  slider.value = minTime;
  slider.step = 1; // 1 second steps

  slider.addEventListener("input", updateMarkers);
}

// Update the graphs with the current markers. Maybe needs
// a new name.
function updateMarkers() {
  const slider = document.getElementById("time-slider");
  const currentTime = parseInt(slider.value);
  console.log(`current Time = ${currentTime}`);

  lmap.clearMarkers();
  for (let i in tracks) {
    let track = tracks[i];
    const position = getPositionAtTime(track, currentTime);
    if (position) {
      lmap.setMarker(position, i);
    }
  }

  drawGraphs(currentTime, all_match);
}

// Save a GPX file to localStorage.
function saveGPXToLocalStorage(name, gpxText) {
  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
    // Replace if same filename already stored.
    const idx = stored.findIndex((e) => e.name === name);
    if (idx >= 0) {
      stored[idx].data = gpxText;
    } else {
      stored.push({ name, data: gpxText });
    }
    localStorage.setItem("gpxUploads", JSON.stringify(stored));
  } catch (e) {
    console.error("Failed to save GPX to localStorage:", e);
  }
}

// Load any previously uploaded GPX files from localStorage.
function loadGPXFromLocalStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
    for (const entry of stored) {
      const track = parseGPX(entry.data);
      data.push(track);
    }
    if (stored.length > 0) {
      dataUpdated();
    }
  } catch (e) {
    console.error("Failed to load GPX from localStorage:", e);
  }
}

// Function to fetch and display a GPX track
function fetchGPXTrack(url) {
  fetch(url)
    .then((response) => response.text())
    .then((gpxData) => {
      const track = parseGPX(gpxData);
      data.push(track);
      dataUpdated();
    })
    .catch((error) => console.error("Error loading GPX:", error));
}

// Populate the saved tracks dropdown from server and localStorage.
function populateSavedTracks() {
  const select = document.getElementById("saved-tracks");

  // Clear existing options except the default placeholder.
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Add localStorage tracks.
  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
    for (const entry of stored) {
      const option = document.createElement("option");
      option.value = "local:" + entry.name;
      option.textContent = entry.name;
      select.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to read localStorage tracks:", e);
  }

  // Add server tracks from /api/tracks.
  fetch("/api/tracks")
    .then((response) => response.json())
    .then((files) => {
      for (const filename of files) {
        const option = document.createElement("option");
        option.value = "server:" + filename;
        option.textContent = filename;
        select.appendChild(option);
      }
    })
    .catch((error) => console.error("Error fetching track list:", error));
}

// Handle saved-tracks dropdown selection.
function addSavedTrackListener() {
  const select = document.getElementById("saved-tracks");
  select.addEventListener("change", (e) => {
    const value = e.target.value;
    if (!value) return;

    // Reset dropdown back to placeholder.
    select.selectedIndex = 0;

    if (value.startsWith("local:")) {
      const name = value.substring(6);
      try {
        const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
        const entry = stored.find((s) => s.name === name);
        if (entry) {
          const track = parseGPX(entry.data);
          data.push(track);
          dataUpdated();
        }
      } catch (err) {
        console.error("Failed to load track from localStorage:", err);
      }
    } else if (value.startsWith("server:")) {
      const filename = value.substring(7);
      fetchGPXTrack("/tracks/" + filename);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  lmap = LeafletMap();

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
  } else if (url.hash == "#test2") {
    console.log("Test2 mode");
    fetchGPXTrack("priest-kennedy.gpx");
    fetchGPXTrack("priest-sombroso.gpx");
  }

  loadGPXFromLocalStorage();
  addFileListener("track");
  addSavedTrackListener();
  populateSavedTracks();
  addGraphTypeListener();
  document
    .querySelector("#trim-tracks-checkbox")
    .addEventListener("change", displayTracks);
});
