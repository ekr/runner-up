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

  // Display mode (for alignment)
  displayModeContainer: '#display-mode',
  displayModeSelect: '#display-mode-select',
  alignmentSummary: '#alignment-summary',

  // Settings (on settings page)
  unitsDropdown: '#units-control',
  saveButton: '#save-button',
  settingsContent: '#settings-content',
  settingsLoginPrompt: '#settings-login-prompt',
  unitsSuccess: '#units-success',
  currentPassword: '#current-password',
  newPassword: '#new-password',
  confirmPassword: '#confirm-password',
  changePasswordBtn: '#change-password-btn',
  passwordError: '#password-error',
  passwordSuccess: '#password-success',
  trackList: '#track-list',
  trackItem: '.track-item',
  deleteAccountBtn: '#delete-account-btn',
  deleteConfirm: '#delete-confirm',
  deletePassword: '#delete-password',
  deleteConfirmBtn: '#delete-confirm-btn',
  deleteCancelBtn: '#delete-cancel-btn',
  deleteError: '#delete-error',
};
