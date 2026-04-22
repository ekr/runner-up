function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function computeLeaderInfo(tracks, currentTime, names) {
  if (!tracks || tracks.length === 0) {
    return { type: 'empty' };
  }

  const getName = (i) => (names && names[i]) ? names[i] : `Track ${i + 1}`;

  if (tracks.length === 1) {
    const dist = getValueAtPosition(tracks[0], 'time', currentTime, 'displayDistance');
    if (dist == null || isNaN(dist)) {
      return { type: 'empty' };
    }
    return {
      type: 'single',
      elapsed: currentTime,
      distance: dist,
      name: getName(0),
    };
  }

  // Compute each track's distance at currentTime.
  const distances = tracks.map((track) =>
    getValueAtPosition(track, 'time', currentTime, 'displayDistance')
  );

  // Fallback if any distance is null/NaN (e.g. empty track).
  if (distances.some((d) => d == null || isNaN(d))) {
    return {
      type: 'fallback',
      elapsed: currentTime,
      tracks: tracks.map((_, i) => ({
        index: i,
        name: getName(i),
        distance: distances[i] ?? 0,
      })),
    };
  }

  // Leader = highest distance; ties go to lowest index.
  let leaderIndex = 0;
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] > distances[leaderIndex]) {
      leaderIndex = i;
    }
  }

  const leaderDistance = distances[leaderIndex];
  const followers = [];

  for (let i = 0; i < tracks.length; i++) {
    if (i === leaderIndex) continue;

    const followerDistance = distances[i];
    const distanceBehind = leaderDistance - followerDistance;

    // Time behind: when does the follower reach leaderDistance?
    const followerMaxDist = tracks[i][tracks[i].length - 1].displayDistance;
    let timeBehind = null;
    if (leaderDistance <= followerMaxDist) {
      const followerTimeAtLeaderDist = getValueAtPosition(
        tracks[i], 'displayDistance', leaderDistance, 'time'
      );
      if (followerTimeAtLeaderDist != null && !isNaN(followerTimeAtLeaderDist)) {
        timeBehind = followerTimeAtLeaderDist - currentTime;
      }
    }

    followers.push({
      index: i,
      name: getName(i),
      distance: followerDistance,
      distanceBehind,
      timeBehind,
    });
  }

  return {
    type: 'race',
    elapsed: currentTime,
    leader: {
      index: leaderIndex,
      name: getName(leaderIndex),
      distance: leaderDistance,
    },
    followers,
  };
}

function renderInfobox(container, info, units) {
  container.innerHTML = '';

  if (!info || info.type === 'empty') {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  const box = document.createElement('div');
  box.className = 'infobox';

  function addRow(label, value) {
    const row = document.createElement('div');
    row.className = 'infobox-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'infobox-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'infobox-value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    box.appendChild(row);
  }

  function addHeader(text) {
    const el = document.createElement('div');
    el.className = 'infobox-section-header';
    el.textContent = text;
    box.appendChild(el);
  }

  function formatDist(meters) {
    return `${units.distanceValue(meters).toFixed(2)} ${units.distanceUnits()}`;
  }

  addRow('Elapsed', formatTime(info.elapsed));

  if (info.type === 'single') {
    addRow('Distance', formatDist(info.distance));
  } else if (info.type === 'fallback') {
    for (const t of info.tracks) {
      addRow(t.name, formatDist(t.distance));
    }
  } else if (info.type === 'race') {
    addHeader('Leader');
    addRow(info.leader.name, formatDist(info.leader.distance));

    for (const f of info.followers) {
      addHeader('Behind');
      const timeStr = f.timeBehind != null
        ? `+${formatTime(f.timeBehind)}`
        : 'not yet reached';
      const distStr = `+${units.distanceValue(f.distanceBehind).toFixed(2)} ${units.distanceUnits()}`;
      addRow(f.name, `${timeStr} · ${distStr}`);
    }
  }

  container.appendChild(box);
}
