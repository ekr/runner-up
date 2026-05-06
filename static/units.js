function Units() {
  function metric() {
    return Settings.get("units") === "metric";
  }

  function distanceValue(distance) {
    return metric() ? distance / 1000 : (distance * 0.62) / 1000;
  }

  function distanceUnits() {
    return metric() ? "km" : "mi";
  }

  function elevationValue(elevation) {
    return metric() ? elevation : elevation * 3.2808;
  }

  function elevationUnits() {
    return metric() ? "m" : "ft";
  }

  function distanceDiffValue(distance) {
    return metric() ? distance : distance * 3.2808;
  }

  function distanceDiffUnits() {
    return metric() ? "m" : "ft";
  }

  // Inverse of distanceValue: converts displayed km/mi back to raw meters.
  function distanceFromDisplayed(v) {
    return metric() ? v * 1000 : (v * 1000) / 0.62;
  }

  return {
    distanceValue,
    distanceUnits,
    elevationValue,
    elevationUnits,
    distanceDiffValue,
    distanceDiffUnits,
    distanceFromDisplayed,
  };
}
