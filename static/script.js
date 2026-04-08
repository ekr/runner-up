let minTime = Infinity;
let maxTime = -Infinity;

// The raw GPX data we loaded in.
let data = [];

// Map from data index to server storage ID.
let dataToStorageId = [];

// Map from data index to whether the track is shared (not owned).
let dataToIsShared = [];

// Map from data index to the username who shared the track (null for own tracks).
let dataToSharedBy = [];

// Map from data index to the custom label (null if not set).
let dataToLabel = [];

// Cache of avatar load state: username -> HTMLImageElement (loaded) or null (failed/pending).
let avatarCache = {};

// Kick off an avatar load for a username if not already attempted.
// The image will be available in avatarCache on subsequent redraws.
function loadAvatarIfNeeded(username) {
  if (!username || username in avatarCache) return;
  avatarCache[username] = null; // mark as pending
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    avatarCache[username] = img;
    refreshLegend();
    updateMarkers();
  };
  img.onerror = () => { avatarCache[username] = null; };
  img.src = avatarUrl(username);
}

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
// Persisted in localStorage so the choice survives a page reload.
// Using var so it's accessible via window.displayMode for testing.
var displayMode = localStorage.getItem('runnerup:displayMode') === 'overlapping' ? 'overlapping' : 'full';

// The map object.
let lmap = undefined;

// Get the display name for a track by index.
// Uses custom label if set, otherwise falls back to date.
// Appends (sharedBy) for shared tracks.
function getTrackDisplayName(index) {
  const track = data[index];
  const label = dataToLabel[index];
  const base = label || getStartDate(track);
  const sharedBy = dataToSharedBy[index];
  return sharedBy ? `${base} (${sharedBy})` : base;
}

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

  // Show/hide the file picker depending on track count.
  document.querySelector("#add-track").style.display =
    data.length >= 2 ? "none" : "flex";

  try {
    displayTracks();
  } catch (e) {
    console.error("Error displaying tracks:", e);
  }

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

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];

    minTime = Math.min(track[0].time, minTime);
    maxTime = Math.max(track[track.length - 1].time, maxTime);

    lmap.drawTrack(track, i);
  }
  const displayNames = data.map((_, i) => getTrackDisplayName(i));
  const dateStrings = data.map((_, i) => getStartDate(data[i]));
  lmap.createLegend(tracks, dataToStorageId, displayNames, dateStrings, dataToIsShared, dataToLabel, dataToSharedBy);
  initializeSlider();
  updateMarkers();
}

// Rebuild just the legend (e.g., after an avatar finishes loading).
function refreshLegend() {
  if (!tracks.length) return;
  const displayNames = data.map((_, i) => getTrackDisplayName(i));
  const dateStrings = data.map((_, i) => getStartDate(data[i]));
  lmap.createLegend(tracks, dataToStorageId, displayNames, dateStrings, dataToIsShared, dataToLabel, dataToSharedBy);
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
        dataToIsShared.push(false);
        dataToSharedBy.push(isLoggedIn() ? getUsername() : null);
        dataToLabel.push(null);
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
      const username = dataToSharedBy[i] || null;
      if (username) loadAvatarIfNeeded(username);
      lmap.setMarker(position, i, username);
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
  if (!isLoggedIn()) return;
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

  // Add server-stored tracks and shared tracks that aren't already displayed.
  try {
    const [stored, shared] = await Promise.all([getAllStoredGPX(), getSharedTracks()]);

    // Build array of track entries with metadata for sorting.
    const trackEntries = [];
    for (const entry of stored) {
      if (displayedIds.has(entry.id)) continue;
      let displayText;
      if (entry.label) {
        displayText = entry.label;
      } else if (entry.date) {
        const d = new Date(entry.date);
        const date = d.toDateString();
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        displayText = `${date} ${time}`;
      } else {
        displayText = "Unknown date";
      }
      trackEntries.push({ entry, displayText, isShared: false, sharedBy: getUsername(), label: entry.label || null });
    }

    for (const entry of shared) {
      if (displayedIds.has(entry.trackId)) continue;
      let displayText;
      if (entry.label) {
        displayText = entry.label;
      } else if (entry.date) {
        const d = new Date(entry.date);
        const date = d.toDateString();
        const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        displayText = `${date} ${time}`;
      } else {
        displayText = "Unknown date";
      }
      displayText += ` (${entry.sharedBy})`;
      trackEntries.push({
        entry: { id: entry.trackId, startLat: entry.startLat, startLon: entry.startLon },
        displayText,
        isShared: true,
        sharedBy: entry.sharedBy,
        label: entry.label || null,
      });
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
    for (const { entry, displayText, isShared, sharedBy, label } of trackEntries) {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = displayText;
      if (isShared) option.dataset.shared = "true";
      if (sharedBy) option.dataset.sharedBy = sharedBy;
      if (label) option.dataset.label = label;
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

    const selectedOption = select.options[select.selectedIndex];
    const isShared = selectedOption.dataset.shared === "true";
    const sharedBy = selectedOption.dataset.sharedBy || null;
    const label = selectedOption.dataset.label || null;

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
        dataToIsShared.push(isShared);
        dataToSharedBy.push(sharedBy);
        dataToLabel.push(label);
        dataUpdated();
        await populateSavedTracks();
      }
    } catch (err) {
      console.error("Failed to load track from server:", err);
    }
  });
}

// Remove a track from display by its data index.
// If permanent is true, also delete from server storage (or remove from shared list).
function removeTrack(trackIndex, permanent) {
  const storageId = dataToStorageId[trackIndex];
  const isShared = dataToIsShared[trackIndex];

  if (permanent && storageId) {
    if (isShared) {
      removeSharedTrack(storageId);
    } else {
      deleteGPXFromStorage(storageId);
    }
  }

  data.splice(trackIndex, 1);
  dataToStorageId.splice(trackIndex, 1);
  dataToIsShared.splice(trackIndex, 1);
  dataToSharedBy.splice(trackIndex, 1);
  dataToLabel.splice(trackIndex, 1);
  dataUpdated();
  populateSavedTracks();
}

// Rename a track and refresh the display.
async function renameTrack(trackIndex, newLabel) {
  const storageId = dataToStorageId[trackIndex];
  const trimmed = newLabel ? newLabel.trim() : null;
  dataToLabel[trackIndex] = trimmed || null;
  if (storageId && isLoggedIn()) {
    if (dataToIsShared[trackIndex]) {
      await apiRenameSharedTrack(storageId, trimmed);
    } else {
      await apiRenameTrack(storageId, trimmed);
    }
  }
  displayTracks();
}

// Update the auth UI based on login state.
function updateAuthUI() {
  const loginForm = document.getElementById("auth-login-form");
  const registerForm = document.getElementById("auth-register-form");
  const authStatus = document.getElementById("auth-status");
  const addTrack = document.getElementById("add-track");

  const banner = document.getElementById("logged-out-banner");
  const savedTracks = document.getElementById("saved-tracks");

  const headerAvatarImg = document.getElementById("header-avatar-img");
  const headerAvatarPlaceholder = document.getElementById("header-avatar-placeholder");

  if (isLoggedIn()) {
    loginForm.style.display = "none";
    registerForm.style.display = "none";
    authStatus.style.display = "flex";
    banner.style.display = "none";
    savedTracks.style.display = "";
    const username = getUsername();
    document.getElementById("auth-username-display").textContent = username;

    // Show placeholder initial.
    headerAvatarPlaceholder.textContent = username.charAt(0);

    // Try to load avatar.
    headerAvatarImg.onload = () => {
      headerAvatarImg.classList.add("loaded");
    };
    headerAvatarImg.onerror = () => {
      headerAvatarImg.classList.remove("loaded");
    };
    headerAvatarImg.src = avatarUrl(username) + "?t=" + Date.now();
  } else {
    loginForm.style.display = "flex";
    registerForm.style.display = "none";
    authStatus.style.display = "none";
    banner.style.display = "block";
    savedTracks.style.display = "none";
    headerAvatarImg.classList.remove("loaded");
  }

  // Always explicitly set add-track visibility based on track count.
  addTrack.style.display = data.length < 2 ? "flex" : "none";
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
      await Settings.load();
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
      await Settings.load();
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
    Settings.load();
    populateSavedTracks();
  }
  addGraphTypeListener();
  addDisplayModeListener();

  // Listen for hash changes (e.g., user pastes a URL with track IDs).
  window.addEventListener("hashchange", () => {
    const newHash = window.location.hash;
    if (newHash.length > 1) {
      // Clear existing tracks before loading from the new hash.
      data.length = 0;
      dataToStorageId.length = 0;
      dataToIsShared.length = 0;
      dataToSharedBy.length = 0;
      dataToLabel.length = 0;
      loadTracksFromHash(newHash);
    }
  });
});

// Add listener for display mode toggle.
function addDisplayModeListener() {
  const modeSelect = document.querySelector("#display-mode-select");
  if (modeSelect) {
    // Sync the DOM to the restored value so the <select> doesn't drift from
    // the JS variable via browser form autofill.
    modeSelect.value = displayMode;
    modeSelect.addEventListener("change", (e) => {
      displayMode = e.target.value;
      localStorage.setItem('runnerup:displayMode', displayMode);
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

      // Determine if this is someone else's track.
      const isOthers = isLoggedIn() && entry.owner && entry.owner !== getUsername();
      dataToIsShared.push(!!isOthers);
      dataToSharedBy.push(entry.owner || null);
      dataToLabel.push(null);

      // If logged in, save this track to our shared tracks list.
      // The server will skip if we already own it or have it shared.
      if (isLoggedIn()) {
        addSharedTrack(trackId);
      }
    } catch (err) {
      console.error("Failed to load shared track:", trackId, err);
    }
  }
  if (data.length > 0) {
    dataUpdated();
  }
  populateSavedTracks();
}
