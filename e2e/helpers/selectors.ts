/**
 * Centralized DOM selectors for RunnerUp e2e tests.
 */
export const selectors = {
  // Track upload controls
  fileInput: '#track',
  fileLabel: '#file-label',
  addTrackContainer: '#add-track',
  savedTracksDropdown: '#saved-tracks',

  // Map elements
  mapContainer: '#map',
  legendContainer: '#legend-container',
  legendEntry: '#legend-container > div',
  deleteButton: '.delete-button',
  mapPolyline: '#map svg path',
  mapMarker: '.my-div-icon',

  // Time slider
  timeSlider: '#time-slider',
  sliderContainer: '#slider-container',

  // Graph elements
  graphContainer: '#graph',
  graphFigure: '#graph figure',
  compareByMenu: '#compare-by-menu',

  // Trim tracks
  trimTracksCheckbox: '#trim-tracks-checkbox',
  trimTracksContainer: '#trim-tracks',

  // Display mode (for alignment)
  displayModeContainer: '#display-mode',
  displayModeSelect: '#display-mode-select',
  alignmentSummary: '#alignment-summary',

  // Settings (on settings page)
  unitsDropdown: '#units-control',
  saveButton: '#save-button',
};
