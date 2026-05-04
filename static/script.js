let minTime = Infinity;
let maxTime = -Infinity;

// Maximum number of tracks that can be loaded simultaneously.
const MAX_TRACKS = 5;

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

// Returns true iff at least one displayed track is owned by someone other than the current user.
function shouldShowAvatars() {
  return dataToIsShared.some(Boolean);
}

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

// Tracks used for the leader infobox. Usually the same as `tracks`, but in
// full-tracks mode with a multi-segment alignment we synthesize a harmonized
// copy (same raw time axis, per-segment scaled distances) so the infobox can
// still pick a meaningful leader while the map keeps showing the raw tracks.
// Null when no coherent comparison is possible.
// Using var so it's accessible via window.infoboxTracks for testing.
var infoboxTracks = null;

// Display mode: 'full' shows entire tracks, 'overlapping' shows only overlapping regions.
// Persisted in localStorage so the choice survives a page reload.
// Using var so it's accessible via window.displayMode for testing.
var displayMode = localStorage.getItem('runnerup:displayMode') === 'overlapping' ? 'overlapping' : 'full';

// The map object.
let lmap = undefined;

// Get the display name for a track by index.
// Uses custom label if set, otherwise falls back to date.
// Appends (sharedBy) to all tracks when at least one displayed track is owned by another user (matches avatar policy).
function getTrackDisplayName(index) {
  const track = data[index];
  const label = dataToLabel[index];
  const base = label || getStartDate(track);
  const sharedBy = dataToSharedBy[index];
  const showSuffix = sharedBy && shouldShowAvatars();
  return showSuffix ? `${base} (${sharedBy})` : base;
}

// The data has been updated, so we need to basically
// start from scratch.
function dataUpdated() {
  if (!data.length) {
    lmap.clear();
    removeGraphs();
    const infoboxContainer = document.getElementById("infobox-container");
    if (infoboxContainer) infoboxContainer.style.display = "none";
    return;
  }

  if (data.length > 2) {
    // N > 2 tracks: find common overlap across all pairwise alignments with track[0].
    const pairwiseAlignments = data.slice(1).map(t => findOverlappingRegions(data[0], t, {
      threshold: 0.03,
      minSegmentPoints: 3
    }));

    if (pairwiseAlignments.some(a => !a || !a.overlappingRegions)) {
      alignment = null;
      segments = null;
    } else {
      const intersection = intersectOverlapRanges(pairwiseAlignments);
      if (!intersection) {
        alignment = null;
        segments = null;
      } else {
        const t1dist = data[0][intersection.track1Range[1]].distance -
                       data[0][intersection.track1Range[0]].distance;
        const t2dist = data[1][intersection.perTrackRanges[0][1]].distance -
                       data[1][intersection.perTrackRanges[0][0]].distance;
        alignment = {
          commonOverlap: intersection,
          pairwiseAlignments,
          hasCommonOverlap: true,
          hasMultipleSegments: false,
          overlappingRegions: [{
            track1Range: intersection.track1Range,
            track2Range: intersection.perTrackRanges[0],
            track1Distance: t1dist,
            track2Distance: t2dist,
            harmonizedDistance: (t1dist + t2dist) / 2
          }],
          totalHarmonizedDistance: t1dist
        };
        segments = [intersection.track1Range];
      }
    }
  } else if (data.length === 2) {
    // Existing 2-track DTW alignment.
    alignment = findOverlappingRegions(data[0], data[1], {
      threshold: 0.03,
      minSegmentPoints: 3
    });
    if (alignment && alignment.overlappingRegions) {
      segments = alignment.overlappingRegions.map(r => [r.track1Range[0], r.track1Range[1]]);
    } else {
      segments = null;
    }
  } else {
    // Single track.
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
      display_mode.style.display = "block";
      const summary = document.querySelector("#alignment-summary");
      if (summary) {
        summary.textContent = getAlignmentSummary(alignment);
      }
    }
  } else if (alignment.hasCommonOverlap) {
    // N > 2 tracks with a single common overlap — show mode toggle.
    console.log("Common overlap found for N tracks");
    if (display_mode) {
      display_mode.style.display = "block";
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
    data.length >= MAX_TRACKS ? "none" : "block";

  try {
    displayTracks();
  } catch (e) {
    console.error("Error displaying tracks:", e);
  }

  // Update the URL hash with current track IDs for sharing.
  updateUrlHash();
}

// For each raw-track point, compute "shared-course progress": harmonized
// distance across overlapping regions only, excluding any detour distance
// between regions. Unlike harmonizeFullTrack, which folds raw off-course
// distance into the cumulative, this answers "how far along the shared
// route is this runner right now" — which is what the leader infobox needs.
function sharedCourseProgressTracks(data, alignment) {
  const regions = alignment.overlappingRegions;
  return data.map((track, trackIndex) => {
    const result = new Array(track.length);
    let cumulative = 0;
    let regionIdx = 0;
    for (let i = 0; i < track.length; i++) {
      while (regionIdx < regions.length) {
        const range = trackIndex === 0
          ? regions[regionIdx].track1Range
          : regions[regionIdx].track2Range;
        if (i <= range[1]) break;
        cumulative += regions[regionIdx].harmonizedDistance;
        regionIdx++;
      }
      let progress = cumulative;
      if (regionIdx < regions.length) {
        const region = regions[regionIdx];
        const range = trackIndex === 0 ? region.track1Range : region.track2Range;
        const rawDist = trackIndex === 0 ? region.track1Distance : region.track2Distance;
        if (i >= range[0]) {
          const scale = rawDist > 0 ? region.harmonizedDistance / rawDist : 1;
          progress += (track[i].distance - track[range[0]].distance) * scale;
        }
      }
      result[i] = { ...track[i], displayDistance: progress };
    }
    return result;
  });
}

// Produce the track list that computeLeaderInfo should consume. In most
// modes this is just `tracks` as-is. The interesting case is full-tracks
// mode with a multi-segment 2-track alignment: `tracks` has raw GPS
// distances (different between the two courses), so picking a leader by
// max displayDistance is meaningless. We build shared-course-progress
// tracks here so the infobox can still compare them.
function computeInfoboxTracks() {
  if (all_match) return tracks;
  if (data.length === 2 && alignment && alignment.overlappingRegions?.length > 0) {
    return sharedCourseProgressTracks(data, alignment);
  }
  return null;
}

function displayTracks() {
  tracks = structuredClone(data);

  if (!segments) {
    all_match = false;
  } else if (segments.length > 1) {
    // Multiple segments — only arises in the 2-track case.
    if (displayMode === 'overlapping' && alignment && tracks.length === 2) {
      const harmonized = createHarmonizedTracks(tracks[0], tracks[1], alignment, true);
      tracks = [harmonized.harmonizedTrack1, harmonized.harmonizedTrack2];
      all_match = true;
    } else {
      all_match = false;
    }
  } else {
    // Single segment (full overlap for 2-track, or intersected common overlap for N-track).
    if (displayMode === 'overlapping' && alignment && alignment.hasCommonOverlap) {
      // N > 2 tracks: extract common overlap and harmonize distances.
      tracks = createHarmonizedTracksN(tracks, alignment);
      all_match = true;
    } else {
      normalizeTracks(tracks);
      all_match = true;
    }
  }
  tracks.forEach((track) => {
    track.forEach((point) => {
      point.displayDistance = point.normalizedDistance ?? point.distance;
    });
  });

  infoboxTracks = computeInfoboxTracks();

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
  const effectiveSharedBy = shouldShowAvatars() ? dataToSharedBy : dataToSharedBy.map(() => null);
  lmap.createLegend(tracks, dataToStorageId, displayNames, dateStrings, dataToIsShared, dataToLabel, effectiveSharedBy);
  initializeSlider();
  updateMarkers();
}

// Rebuild just the legend (e.g., after an avatar finishes loading).
function refreshLegend() {
  if (!tracks.length) return;
  const displayNames = data.map((_, i) => getTrackDisplayName(i));
  const dateStrings = data.map((_, i) => getStartDate(data[i]));
  const effectiveSharedBy = shouldShowAvatars() ? dataToSharedBy : dataToSharedBy.map(() => null);
  lmap.createLegend(tracks, dataToStorageId, displayNames, dateStrings, dataToIsShared, dataToLabel, effectiveSharedBy);
}

// Add a track from raw GPX text. Parses, pushes into `data`, and persists
// to server storage when logged in. Throws if the GPX is unparseable.
async function addTrackFromGPXText(gpxText) {
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
        await addTrackFromGPXText(e.target.result);
      };
      reader.readAsText(file);
    }
  });
}

// Listen for GPX URLs to be submitted.
function addUrlListener() {
  const input = document.getElementById("track-url");
  const button = document.getElementById("track-url-btn");
  const errorEl = document.getElementById("track-url-error");
  if (!input || !button) return;

  const submit = async () => {
    const url = input.value.trim();
    errorEl.textContent = "";
    if (!url) return;
    try {
      new URL(url);
    } catch {
      errorEl.textContent = "Invalid URL.";
      return;
    }
    button.disabled = true;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const gpxText = await response.text();
      await addTrackFromGPXText(gpxText);
      input.value = "";
    } catch (err) {
      console.error("Failed to load GPX from URL:", err);
      const msg = err && err.message ? err.message : String(err);
      // fetch() throws a bare TypeError for CORS/network errors; clarify.
      if (err instanceof TypeError) {
        errorEl.textContent = "Could not fetch URL (network or CORS error).";
      } else {
        errorEl.textContent = `Failed to load: ${msg}`;
      }
    } finally {
      button.disabled = false;
    }
  };

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
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
      const username = shouldShowAvatars() ? (dataToSharedBy[i] || null) : null;
      if (username) loadAvatarIfNeeded(username);
      lmap.setMarker(position, i, username);
    }
  }

  drawGraphs(currentTime, all_match);

  const infoboxContainer = document.getElementById("infobox-container");
  if (infoboxContainer) {
    // `infoboxTracks` is null when no coherent comparison is possible
    // (e.g., no alignment at all). In that case hide instead of picking a
    // nonsense leader from raw distances.
    if (!infoboxTracks) {
      infoboxContainer.style.display = "none";
    } else {
      const names = data.map((_, i) => getTrackDisplayName(i));
      renderInfobox(
        infoboxContainer,
        computeLeaderInfo(infoboxTracks, currentTime, names),
        Units()
      );
    }
  }
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
        const date = d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
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
        const date = d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
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

  const headerAvatarImg = document.getElementById("header-avatar-img");
  const headerAvatarPlaceholder = document.getElementById("header-avatar-placeholder");

  if (isLoggedIn()) {
    loginForm.style.display = "none";
    registerForm.style.display = "none";
    authStatus.style.display = "flex";
    banner.style.display = "none";
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
    headerAvatarImg.classList.remove("loaded");
  }

  // Hide/show elements that require login (e.g., saved-tracks method group).
  document.querySelectorAll('.js-needs-login').forEach(el => {
    el.style.display = isLoggedIn() ? '' : 'none';
  });

  // Always explicitly set add-track visibility based on track count.
  addTrack.style.display = data.length < MAX_TRACKS ? "block" : "none";
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
    .then((response) => (response.ok ? response.text() : null))
    .then((v) => {
      if (v == null) {
        document.getElementById("deploy-label").style.display = "none";
        return;
      }
      document.querySelector("#deploy-date").textContent = v.trim();
    });

  // Set up auth UI.
  setupAuthListeners();
  updateAuthUI();

  // Check if URL contains shared track IDs (works without login).
  const url = new URL(window.location);
  if (url.hash.length > 1) {
    loadTracksFromHash(url.hash);
  }

  addFileListener("track");
  addUrlListener();
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

// Load tracks from the URL hash (e.g., #trackId1/trackId2/trackId3).
async function loadTracksFromHash(hash) {
  let parts = hash.slice(1).split('/').filter(Boolean);
  if (parts.length === 0) return;
  if (parts.length > MAX_TRACKS) {
    console.warn(`Hash contains ${parts.length} track IDs; truncating to first ${MAX_TRACKS}.`);
    parts = parts.slice(0, MAX_TRACKS);
  }

  // Pre-fetch label lookups for logged-in users so custom labels survive reload.
  // getAllStoredGPX/getSharedTracks both return [] on error, so no try/catch needed.
  let storedLabelMap = new Map();
  let sharedLabelMap = new Map();
  if (isLoggedIn()) {
    const [stored, shared] = await Promise.all([getAllStoredGPX(), getSharedTracks()]);
    for (const entry of stored) {
      if (entry.label) storedLabelMap.set(entry.id, entry.label);
    }
    for (const entry of shared) {
      if (entry.label) sharedLabelMap.set(entry.trackId, entry.label);
    }
  }

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

      // Restore any custom label the user assigned to this track.
      const label = isLoggedIn()
        ? (isOthers ? sharedLabelMap.get(trackId) : storedLabelMap.get(trackId)) ?? null
        : null;
      dataToLabel.push(label);

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
