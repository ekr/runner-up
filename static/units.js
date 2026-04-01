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

  return {
    distanceValue,
    distanceUnits,
    elevationValue,
    elevationUnits,
    distanceDiffValue,
    distanceDiffUnits,
  };
}
