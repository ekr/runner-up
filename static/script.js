let minTime = Infinity;
let maxTime = -Infinity;

// The raw GPX data we loaded in.
let data = [];

// Map from data index to localStorage entry ID.
let dataToStorageId = [];

// The tracks to actually plot transformed into ready-to-plot
// version.
let tracks = [];

// The alignment result from findOverlappingRegions.
let alignment = null;

// Whether we have a single course where all the tracks line
// up, either because it was created that way or because
// we merged the matching segments.
let all_match = null;

// Display mode: 'full' shows entire tracks, 'overlapping' shows only overlapping regions.
let displayMode = 'full';

// The map object.
let lmap = undefined;

// The data has been updated, so we need to basically
// start from scratch.
function dataUpdated() {
  if (!data.length) {
    lmap.clear();
    removeGraphs();
    updateDisplayModeUI();
    return;
  }

  // Compute alignment for multiple tracks
  if (data.length > 1) {
    alignment = findOverlappingRegions(data[0], data[1], {
      threshold: 0.03,  // 30 meters
      searchWindow: 30,
      minSegmentPoints: 3
    });
  } else {
    // Single track - no alignment needed
    alignment = null;
  }

  updateDisplayModeUI();
  displayTracks();

  // Show/hide the file picker depending on how many tracks have
  // been loaded.
  document.querySelector("#add-track").style.display =
    data.length >= 2 ? "none" : "flex";
}

// Update the display mode UI based on alignment state.
function updateDisplayModeUI() {
  const displayModeContainer = document.querySelector("#display-mode");

  if (!alignment) {
    // No alignment or single track - hide display mode selector
    displayModeContainer.style.display = "none";
    return;
  }

  if (alignment.hasMultipleSegments) {
    // Multiple segments - show the selector
    displayModeContainer.style.display = "flex";
    const summary = getAlignmentSummary(alignment);
    document.querySelector("#alignment-summary").textContent = summary;
  } else {
    // Single overlapping region - hide selector, tracks fully align
    displayModeContainer.style.display = "none";
  }
}

function displayTracks() {
  tracks = structuredClone(data);

  if (data.length === 1) {
    // Single track - no alignment needed
    all_match = true;
    tracks[0].forEach((point) => {
      point.displayDistance = point.distance;
      point.normalizedDistance = point.distance;
    });
  } else if (!alignment) {
    // Multiple tracks but no alignment found
    all_match = false;
  } else if (alignment.hasMultipleSegments) {
    // Multiple overlapping segments - use display mode
    const overlappingOnly = displayMode === 'overlapping';
    const harmonized = createHarmonizedTracks(
      data[0], data[1], alignment, overlappingOnly
    );
    tracks = [harmonized.harmonizedTrack1, harmonized.harmonizedTrack2];
    all_match = true;
  } else {
    // Single overlapping region - harmonize distances
    const harmonized = createHarmonizedTracks(data[0], data[1], alignment, false);
    tracks = [harmonized.harmonizedTrack1, harmonized.harmonizedTrack2];
    all_match = true;
  }

  // Set displayDistance for all points
  tracks.forEach((track) => {
    track.forEach((point) => {
      point.displayDistance = point.normalizedDistance ?? point.distance;
    });
  });

  // Clean up
  lmap.clear();
  removeGraphs();

  // Reset time bounds
  minTime = Infinity;
  maxTime = -Infinity;

  for (let i in tracks) {
    const track = tracks[i];

    if (track.length > 0) {
      minTime = Math.min(track[0].time, minTime);
      maxTime = Math.max(track[track.length - 1].time, maxTime);
    }

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
      reader.onload = async (e) => {
        const gpxText = e.target.result;
        const track = parseGPX(gpxText);
        data.push(track);
        const storageId = await saveGPXToLocalStorage(gpxText);
        dataToStorageId.push(storageId);
        dataUpdated();
        populateSavedTracks();
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

// Save a GPX file to localStorage. Returns the storage ID (content hash).
async function saveGPXToLocalStorage(gpxText) {
  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");

    // Use SHA-256 content hash as ID - automatically handles duplicates.
    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(gpxText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const id = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Check if this content already exists.
    const existingIdx = stored.findIndex((e) => e.id === id);
    if (existingIdx >= 0) {
      // Return the existing entry's ID.
      return id;
    }

    // Create new entry with content hash as ID.
    stored.push({ id, data: gpxText });
    localStorage.setItem("gpxUploads", JSON.stringify(stored));
    return id;
  } catch (e) {
    console.error("Failed to save GPX to localStorage:", e);
    if (e.name === "QuotaExceededError") {
      alert("Storage is full. Cannot save track. Try deleting some saved tracks (Shift+click the delete button).");
    } else {
      alert("Failed to save track to storage: " + e.message);
    }
    return null;
  }
}

// Delete a GPX track from localStorage by its storage ID.
function deleteGPXFromLocalStorage(storageId) {
  if (!storageId) return;

  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
    const newStored = stored.filter((entry) => entry.id !== storageId);
    localStorage.setItem("gpxUploads", JSON.stringify(newStored));
  } catch (e) {
    console.error("Failed to delete GPX from localStorage:", e);
  }
}

// Function to fetch and display a GPX track
function fetchGPXTrack(url) {
  fetch(url)
    .then((response) => response.text())
    .then((gpxData) => {
      const track = parseGPX(gpxData);
      data.push(track);
      dataToStorageId.push(null); // Not from localStorage
      dataUpdated();
    })
    .catch((error) => console.error("Error loading GPX:", error));
}

// Get the set of storage IDs currently being displayed.
function getDisplayedStorageIds() {
  return new Set(dataToStorageId.filter((id) => id !== null));
}

// Populate the saved tracks dropdown from localStorage.
// Excludes tracks that are already being displayed.
function populateSavedTracks() {
  const select = document.getElementById("saved-tracks");

  // Clear existing options except the default placeholder.
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Get IDs of tracks currently displayed.
  const displayedIds = getDisplayedStorageIds();

  // Add localStorage tracks that aren't already displayed.
  try {
    const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
    for (const entry of stored) {
      // Skip if already displayed.
      if (displayedIds.has(entry.id)) {
        continue;
      }
      const option = document.createElement("option");
      option.value = entry.id;
      // Parse GPX to get the start date for display.
      try {
        const track = parseGPX(entry.data);
        option.textContent = getStartDate(track);
      } catch (parseErr) {
        option.textContent = "Unknown date";
      }
      select.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to read localStorage tracks:", e);
  }
}

// Handle saved-tracks dropdown selection.
function addSavedTrackListener() {
  const select = document.getElementById("saved-tracks");
  select.addEventListener("change", (e) => {
    const storageId = e.target.value;
    if (!storageId) return;

    // Reset dropdown back to placeholder.
    select.selectedIndex = 0;

    try {
      const stored = JSON.parse(localStorage.getItem("gpxUploads") || "[]");
      const entry = stored.find((s) => s.id === storageId);
      if (entry) {
        let track;
        try {
          track = parseGPX(entry.data);
        } catch (parseErr) {
          console.error("Failed to parse GPX data:", parseErr);
          alert("Failed to load track: corrupted GPX data.");
          return;
        }

        data.push(track);
        dataToStorageId.push(storageId);
        dataUpdated();
        populateSavedTracks();
      }
    } catch (err) {
      console.error("Failed to load track from localStorage:", err);
    }
  });
}

// Remove a track from display by its data index.
// If permanent is true, also delete from localStorage.
function removeTrack(trackIndex, permanent) {
  const storageId = dataToStorageId[trackIndex];

  if (permanent && storageId) {
    deleteGPXFromLocalStorage(storageId);
  }

  data.splice(trackIndex, 1);
  dataToStorageId.splice(trackIndex, 1);
  dataUpdated();
  populateSavedTracks();
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

  addFileListener("track");
  addSavedTrackListener();
  populateSavedTracks();
  addGraphTypeListener();
  addDisplayModeListener();
});

// Add listener for display mode toggle.
function addDisplayModeListener() {
  const modeSelect = document.querySelector("#display-mode-select");
  if (modeSelect) {
    modeSelect.addEventListener("change", (e) => {
      displayMode = e.target.value;
      displayTracks();
    });
  }
}
