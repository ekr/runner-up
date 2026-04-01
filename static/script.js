let minTime = Infinity;
let maxTime = -Infinity;

// The raw GPX data we loaded in.
let data = [];

// Map from data index to server storage ID.
let dataToStorageId = [];

// The tracks to actually plot transformed into ready-to-plot
// version.
// Using var so it's accessible via window.tracks for testing.
var tracks = [];

// The individual matching segments for each track.
let segments = null;

// The alignment result from findOverlappingRegions (new).
// Using var so it's accessible via window.alignment for testing.
var alignment = null;

// Whether we have a single course where all the tracks line
// up, either because it was created that way or because
// we merged the matching segments.
// Using var so it's accessible via window.all_match for testing.
var all_match = null;

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
    return;
  }
  // TODO(ekr@rtfm.com): Handle >2 tracks.
  if (data.length > 1) {
    // Use DTW alignment (handles different sampling rates correctly)
    alignment = findOverlappingRegions(data[0], data[1], {
      threshold: 0.03,
      minSegmentPoints: 3
    });
    // Derive segments from alignment for backward compatibility
    if (alignment && alignment.overlappingRegions) {
      segments = alignment.overlappingRegions.map(r => [r.track1Range[0], r.track1Range[1]]);
    } else {
      segments = null;
    }
  } else {
    segments = [[0, data[0].length - 1]];
    alignment = null;
  }

  const display_mode = document.querySelector("#display-mode");

  if (!alignment || !alignment.overlappingRegions) {
    console.log("No matching segments");
    if (display_mode) display_mode.style.display = "none";
  } else if (alignment.hasMultipleSegments) {
    console.log("More than one segment");
    if (display_mode) {
      display_mode.style.display = "flex";
      const summary = document.querySelector("#alignment-summary");
      if (summary) {
        summary.textContent = getAlignmentSummary(alignment);
      }
    }
  } else {
    console.log("All segments match");
    if (display_mode) display_mode.style.display = "none";
  }

  displayTracks();

  // Show/hide the file picker depending on track count.
  document.querySelector("#add-track").style.display =
    data.length >= 2 ? "none" : "flex";

  // Update the URL hash with current track IDs for sharing.
  updateUrlHash();
}

function displayTracks() {
  tracks = structuredClone(data);

  if (!segments) {
    all_match = false;
  } else if (segments.length > 1) {
    if (displayMode === 'overlapping' && alignment && tracks.length === 2) {
      // Use new alignment-based harmonization for overlapping regions only
      const harmonized = createHarmonizedTracks(tracks[0], tracks[1], alignment, true);
      tracks = [harmonized.harmonizedTrack1, harmonized.harmonizedTrack2];
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
  lmap.createLegend(tracks, dataToStorageId);
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
        if (isLoggedIn()) {
          const storageId = await saveGPXToStorage(gpxText);
          dataToStorageId.push(storageId);
        } else {
          dataToStorageId.push(null);
        }
        dataUpdated();
        if (isLoggedIn()) {
          populateSavedTracks();
        }
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

// Get the set of storage IDs currently being displayed.
function getDisplayedStorageIds() {
  return new Set(dataToStorageId.filter((id) => id !== null));
}

// Populate the saved tracks dropdown from server storage.
// Excludes tracks that are already being displayed.
// If a track is displayed, sorts remaining tracks by proximity to displayed track's start.
async function populateSavedTracks() {
  const select = document.getElementById("saved-tracks");

  // Clear existing options except the default placeholder.
  while (select.options.length > 1) {
    select.remove(1);
  }

  // Get IDs of tracks currently displayed.
  const displayedIds = getDisplayedStorageIds();

  // Get reference point for sorting (start of first displayed track).
  let referencePoint = null;
  if (data.length > 0 && data[0].length > 0) {
    referencePoint = { lat: data[0][0].lat, lon: data[0][0].lon };
  }

  // Add server-stored tracks that aren't already displayed.
  try {
    const stored = await getAllStoredGPX();

    // Build array of track entries with metadata for sorting.
    const trackEntries = [];
    for (const entry of stored) {
      // Skip if already displayed.
      if (displayedIds.has(entry.id)) {
        continue;
      }
      let displayText = "Unknown date";
      if (entry.date) {
        const d = new Date(entry.date);
        const date = d.toDateString();
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        displayText = `${date} ${time}`;
      }
      trackEntries.push({ entry, displayText });
    }

    // Sort by proximity to displayed track's start point (closest first).
    if (referencePoint) {
      trackEntries.sort((a, b) => {
        if (a.entry.startLat == null) return 1;
        if (b.entry.startLat == null) return -1;

        const distA = getDistanceFromLatLonInKm(
          referencePoint.lat, referencePoint.lon,
          a.entry.startLat, a.entry.startLon
        );
        const distB = getDistanceFromLatLonInKm(
          referencePoint.lat, referencePoint.lon,
          b.entry.startLat, b.entry.startLon
        );
        return distA - distB;
      });
    }

    // Add sorted entries to dropdown.
    for (const { entry, displayText } of trackEntries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = displayText;
      select.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to read stored tracks:", e);
  }
}

// Handle saved-tracks dropdown selection.
function addSavedTrackListener() {
  const select = document.getElementById("saved-tracks");
  select.addEventListener("change", async (e) => {
    const storageId = e.target.value;
    if (!storageId) return;

    // Reset dropdown back to placeholder.
    select.selectedIndex = 0;

    try {
      const entry = await getGPXById(storageId);
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
        await populateSavedTracks();
      }
    } catch (err) {
      console.error("Failed to load track from server:", err);
    }
  });
}

// Remove a track from display by its data index.
// If permanent is true, also delete from server storage.
function removeTrack(trackIndex, permanent) {
  const storageId = dataToStorageId[trackIndex];

  if (permanent && storageId) {
    deleteGPXFromStorage(storageId);
  }

  data.splice(trackIndex, 1);
  dataToStorageId.splice(trackIndex, 1);
  dataUpdated();
  populateSavedTracks();
}

// Update the auth UI based on login state.
function updateAuthUI() {
  const loginForm = document.getElementById("auth-login-form");
  const registerForm = document.getElementById("auth-register-form");
  const authStatus = document.getElementById("auth-status");
  const addTrack = document.getElementById("add-track");

  const banner = document.getElementById("logged-out-banner");
  const savedTracks = document.getElementById("saved-tracks");

  if (isLoggedIn()) {
    loginForm.style.display = "none";
    registerForm.style.display = "none";
    authStatus.style.display = "flex";
    banner.style.display = "none";
    savedTracks.style.display = "";
    document.getElementById("auth-username-display").textContent = getUsername();
    // Show add-track controls (unless 2 tracks already loaded).
    if (data.length < 2) {
      addTrack.style.display = "flex";
    }
  } else {
    loginForm.style.display = "flex";
    registerForm.style.display = "none";
    authStatus.style.display = "none";
    banner.style.display = "block";
    savedTracks.style.display = "none";
    // Show add-track controls (unless 2 tracks already loaded).
    if (data.length < 2) {
      addTrack.style.display = "flex";
    }
  }
}

// Set up auth event listeners.
function setupAuthListeners() {
  // Login button.
  document.getElementById("auth-login-btn").addEventListener("click", async () => {
    const username = document.getElementById("auth-username").value.trim();
    const password = document.getElementById("auth-password").value;
    const errorEl = document.getElementById("auth-error");
    errorEl.textContent = "";

    try {
      await apiLogin(username, password);
      updateAuthUI();
      populateSavedTracks();
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  // Allow Enter key in login fields.
  for (const id of ["auth-username", "auth-password"]) {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("auth-login-btn").click();
    });
  }

  // Show register form.
  document.getElementById("auth-register-toggle").addEventListener("click", () => {
    document.getElementById("auth-login-form").style.display = "none";
    document.getElementById("auth-register-form").style.display = "flex";
    document.getElementById("auth-error").textContent = "";
    document.getElementById("reg-error").textContent = "";
  });

  // Back to login.
  document.getElementById("auth-back-btn").addEventListener("click", () => {
    document.getElementById("auth-register-form").style.display = "none";
    document.getElementById("auth-login-form").style.display = "flex";
    document.getElementById("reg-error").textContent = "";
  });

  // Register button.
  document.getElementById("auth-register-btn").addEventListener("click", async () => {
    const username = document.getElementById("reg-username").value.trim();
    const password = document.getElementById("reg-password").value;
    const inviteCode = document.getElementById("reg-invite").value.trim();
    const errorEl = document.getElementById("reg-error");
    errorEl.textContent = "";

    try {
      await apiRegister(username, password, inviteCode);
      updateAuthUI();
      populateSavedTracks();
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  // Allow Enter key in register fields.
  for (const id of ["reg-username", "reg-password", "reg-invite"]) {
    document.getElementById(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("auth-register-btn").click();
    });
  }

  // Logout button.
  document.getElementById("auth-logout-btn").addEventListener("click", () => {
    logout();
    updateAuthUI();
    // Clear the saved tracks dropdown since we're logged out.
    const select = document.getElementById("saved-tracks");
    while (select.options.length > 1) {
      select.remove(1);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  lmap = LeafletMap();

  // Set up the deploy date.
  fetch("deploy-date.txt")
    .then((response) => response.text())
    .then((v) => (document.querySelector("#deploy-date").textContent = v));

  // Set up auth UI.
  setupAuthListeners();
  updateAuthUI();

  // Check if URL contains shared track IDs (works without login).
  const url = new URL(window.location);
  if (url.hash.length > 1) {
    loadTracksFromHash(url.hash);
  }

  addFileListener("track");
  addSavedTrackListener();
  if (isLoggedIn()) {
    populateSavedTracks();
  }
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

// Update the URL hash with current track IDs so the URL is always shareable.
function updateUrlHash() {
  const trackIds = dataToStorageId.filter((id) => id !== null);
  if (trackIds.length > 0) {
    window.history.replaceState(null, '', '#' + trackIds.join('/'));
  } else {
    window.history.replaceState(null, '', window.location.pathname);
  }
}

// Load tracks from the URL hash (e.g., #trackId1/trackId2).
async function loadTracksFromHash(hash) {
  const parts = hash.slice(1).split('/').filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return;

  for (const trackId of parts) {
    try {
      const entry = await getGPXById(trackId);
      if (!entry) {
        console.error("Track not found:", trackId);
        continue;
      }
      const track = parseGPX(entry.data);
      data.push(track);
      dataToStorageId.push(entry.id);
    } catch (err) {
      console.error("Failed to load shared track:", trackId, err);
    }
  }
  if (data.length > 0) {
    dataUpdated();
  }
  populateSavedTracks();
}
