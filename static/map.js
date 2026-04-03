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

  function createLegend(tracks, storageIds, displayNames, dateStrings, isSharedArr, labels) {
    const legendContainer = document.getElementById("legend-container");
    clearChildren(legendContainer);
    for (let i in tracks) {
      const track = tracks[i];

      const legendLine = document.getElementById("legend-line");
      const clone = legendLine.content.cloneNode(true);
      const legendText = clone.querySelector("#legend-text");
      legendText.textContent = displayNames ? displayNames[i] : getStartDate(track);
      legendText.title = dateStrings ? dateStrings[i] : getStartDate(track);
      clone.querySelector("#legend-icon").style.backgroundColor = getColor(i);
      let trackId = i;

      // Inline rename on click (requires a storage ID and being logged in).
      const canRename = storageIds && storageIds[i] && typeof isLoggedIn === 'function' && isLoggedIn();
      if (canRename) {
        legendText.style.cursor = "pointer";
        legendText.addEventListener("click", () => {
          const currentLabel = labels ? labels[i] : null;
          const input = document.createElement("input");
          input.type = "text";
          input.value = currentLabel || "";
          input.placeholder = dateStrings ? dateStrings[i] : getStartDate(track);
          input.style.cssText = "font-size: inherit; width: 160px; padding: 1px 4px; border: 1px solid #999; border-radius: 3px;";

          const commitRename = () => {
            const newLabel = input.value.trim();
            input.replaceWith(legendText);
            renameTrack(parseInt(trackId), newLabel || null);
          };

          input.addEventListener("blur", commitRename);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
            if (e.key === "Escape") {
              input.removeEventListener("blur", commitRename);
              input.replaceWith(legendText);
            }
          });

          legendText.replaceWith(input);
          input.focus();
          input.select();
        });
      }

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

      const downloadBtn = clone.querySelector(".download-button");
      const storageId = storageIds && storageIds[i];
      if (storageId) {
        downloadBtn.addEventListener("click", async () => {
          const entry = await getGPXById(storageId);
          if (!entry) return;
          const blob = new Blob([entry.data], { type: "application/gpx+xml" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const dateStr = getStartDate(track).replace(/[/:]/g, "-").replace(/\s+/g, "_");
          a.download = `${dateStr}.gpx`;
          a.click();
          URL.revokeObjectURL(url);
        });
      } else {
        downloadBtn.style.display = "none";
      }

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
