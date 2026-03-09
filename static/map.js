function LeafletMap() {
  // The map itself.
  const map = L.map("map").setView([0, 0], 2); // Set initial view to a very zoomed out view.

  // The markers we are showing on the map.
  let markers = [];

  // Add a tile layer (OpenStreetMap)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markerGroup = L.featureGroup().addTo(map);

  function drawTrack(track) {
    const latlngs = track.map((point) => [point.lat, point.lon]);
    const polyline = L.polyline(latlngs, {
      color: getColor(i),
      opacity: 0.5,
    }).addTo(markerGroup);
    map.fitBounds(polyline.getBounds()); // Zoom to the track
  }

  function setMarker(position, trackIndex) {
    const color = getColor(trackIndex);
    const marker = L.marker([position.lat, position.lon], {
      icon: L.divIcon({
        className: "my-div-icon",
        html: `<div style="background-color: ${color}; width: 10px; height: 10px; border-radius: 5px;"></div>`,
      }),
    }).addTo(map);
    markers.push(marker);
  }

  function clear() {
    markerGroup.clearLayers();
    clearMarkers();
    const legendContainer = document.getElementById("legend-container");
    clearChildren(legendContainer);
  }

  function clearMarkers() {
    while (markers.length) {
      markers.pop().remove();
    }
  }

  function createLegend(tracks) {
    const legendContainer = document.getElementById("legend-container");
    clearChildren(legendContainer);
    for (let i in tracks) {
      const track = tracks[i];

      const legendLine = document.getElementById("legend-line");
      const clone = legendLine.content.cloneNode(true);
      clone.querySelector("#legend-text").textContent =
        `Date: ${getStartDate(track)}`;
      clone.querySelector("#legend-icon").style.backgroundColor = getColor(i);
      let trackId = i;

      clone.querySelector(".delete-button").addEventListener("click", (e) => {
        if (e.shiftKey) {
          // Shift+click: permanently delete from localStorage
          const trackDate = getStartDate(track);
          if (confirm(`Permanently delete track from ${trackDate} from saved tracks?`)) {
            removeTrack(trackId, true);
          }
        } else {
          // Normal click: remove from display only
          removeTrack(trackId, false);
        }
      });

      legendContainer.appendChild(clone);
    }

    legendContainer.style.top = "10px";
    legendContainer.style.right = "10px";
    legendContainer.style.backgroundColor = "white";
    legendContainer.style.padding = "10px";
    legendContainer.style.border = "1px solid #ccc";
  }

  return {
    drawTrack,
    setMarker,
    clear,
    clearMarkers,
    createLegend,
  };
}
