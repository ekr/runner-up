document.addEventListener("DOMContentLoaded", async () => {
  const loginPrompt = document.querySelector("#settings-login-prompt");
  const content = document.querySelector("#settings-content");

  if (!isLoggedIn()) {
    loginPrompt.style.display = "";
    content.style.display = "none";
    return;
  }

  loginPrompt.style.display = "none";
  content.style.display = "";

  await Settings.load();

  // --- Avatar ---
  const avatarPreview = document.querySelector("#avatar-preview");
  const avatarFileInput = document.querySelector("#avatar-file-input");
  const avatarUploadBtn = document.querySelector("#avatar-upload-btn");
  const avatarRemoveBtn = document.querySelector("#avatar-remove-btn");
  const avatarError = document.querySelector("#avatar-error");
  const avatarSuccess = document.querySelector("#avatar-success");

  function showAvatarLoaded(src) {
    avatarPreview.src = src;
    avatarPreview.classList.add("loaded");
    avatarRemoveBtn.style.display = "";
  }

  function showAvatarPlaceholder() {
    avatarPreview.src = "";
    avatarPreview.classList.remove("loaded");
    avatarRemoveBtn.style.display = "none";
  }

  // Load existing avatar.
  const username = getUsername();
  if (username) {
    const img = new Image();
    img.onload = () => showAvatarLoaded(avatarUrl(username) + "?t=" + Date.now());
    img.onerror = () => showAvatarPlaceholder();
    img.src = avatarUrl(username);
  }

  avatarUploadBtn.addEventListener("click", () => {
    avatarFileInput.click();
  });

  async function resizeImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create image blob"));
        }, "image/png");
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = URL.createObjectURL(file);
    });
  }

  avatarFileInput.addEventListener("change", async () => {
    avatarError.textContent = "";
    avatarSuccess.textContent = "";

    const file = avatarFileInput.files[0];
    if (!file) return;

    if (!file.type.match(/^image\/(png|jpeg)$/)) {
      avatarError.textContent = "Please select a PNG or JPEG image.";
      avatarFileInput.value = "";
      return;
    }

    try {
      const resized = await resizeImage(file);
      await apiUploadAvatar(resized);
      showAvatarLoaded(URL.createObjectURL(resized));
      avatarSuccess.textContent = "Avatar updated.";
      setTimeout(() => { avatarSuccess.textContent = ""; }, 3000);
    } catch (e) {
      avatarError.textContent = "Upload failed: " + e.message;
    }

    avatarFileInput.value = "";
  });

  avatarRemoveBtn.addEventListener("click", async () => {
    avatarError.textContent = "";
    avatarSuccess.textContent = "";
    try {
      await apiDeleteAvatar();
      showAvatarPlaceholder();
    } catch (e) {
      avatarError.textContent = "Failed to remove avatar: " + e.message;
    }
  });

  // --- Units ---
  const unitsControl = document.querySelector("#units-control");
  const saveButton = document.querySelector("#save-button");
  const unitsSuccess = document.querySelector("#units-success");

  unitsControl.value = Settings.get("units");

  saveButton.addEventListener("click", async () => {
    await Settings.set("units", unitsControl.value);
    unitsSuccess.textContent = "Saved";
    setTimeout(() => { unitsSuccess.textContent = ""; }, 2000);
  });

  // --- Change Password ---
  const currentPasswordInput = document.querySelector("#current-password");
  const newPasswordInput = document.querySelector("#new-password");
  const confirmPasswordInput = document.querySelector("#confirm-password");
  const changePasswordBtn = document.querySelector("#change-password-btn");
  const passwordError = document.querySelector("#password-error");
  const passwordSuccess = document.querySelector("#password-success");

  changePasswordBtn.addEventListener("click", async () => {
    passwordError.textContent = "";
    passwordSuccess.textContent = "";

    const currentPassword = currentPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!currentPassword || !newPassword) {
      passwordError.textContent = "Please fill in all fields.";
      return;
    }

    if (newPassword.length < 8) {
      passwordError.textContent = "New password must be at least 8 characters.";
      return;
    }

    if (newPassword !== confirmPassword) {
      passwordError.textContent = "New passwords do not match.";
      return;
    }

    try {
      await apiChangePassword(currentPassword, newPassword);
      passwordSuccess.textContent = "Password changed successfully.";
      currentPasswordInput.value = "";
      newPasswordInput.value = "";
      confirmPasswordInput.value = "";
    } catch (e) {
      passwordError.textContent = e.message;
    }
  });

  // --- Track List ---
  const trackList = document.querySelector("#track-list");
  const tracksError = document.querySelector("#tracks-error");

  function createTrackItem(track, isShared) {
    const trackId = isShared ? track.trackId : track.id;
    const item = document.createElement("div");
    item.className = "track-item";

    const info = document.createElement("div");
    info.className = "track-item-info";

    const nameRow = document.createElement("div");
    nameRow.className = "track-item-name-row";

    const dateStr = track.date
      ? new Date(track.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      : "Unknown date";

    const nameSpan = document.createElement("span");
    nameSpan.className = "track-item-date";
    let displayName = track.label || dateStr;
    if (isShared) displayName += ` (${track.sharedBy})`;
    nameSpan.textContent = displayName;

    nameRow.appendChild(nameSpan);

    const renameBtn = document.createElement("button");
    renameBtn.className = "rename-button";
    renameBtn.textContent = "\u270E";
    renameBtn.title = "Rename track";
    renameBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "track-rename-input";
      input.value = track.label || "";
      input.placeholder = dateStr;

      const commitRename = async () => {
        const newLabel = input.value.trim();
        track.label = newLabel || undefined;
        let newDisplayName = newLabel || dateStr;
        if (isShared) newDisplayName += ` (${track.sharedBy})`;
        nameSpan.textContent = newDisplayName;
        input.replaceWith(nameSpan);
        renameBtn.style.display = "";
        // Rebuild details to include/exclude date
        const parts = [];
        if (track.sizeBytes) parts.push(formatBytes(track.sizeBytes));
        if (track.startLat != null && track.startLon != null) {
          parts.push(`${track.startLat.toFixed(2)}, ${track.startLon.toFixed(2)}`);
        }
        if (newLabel && track.date) parts.push(dateStr);
        details.textContent = parts.join(" \u00B7 ");
        if (parts.length > 0) {
          if (!details.parentNode) info.appendChild(details);
        } else {
          details.remove();
        }
        if (isShared) {
          await apiRenameSharedTrack(trackId, newLabel || null);
        } else {
          await apiRenameTrack(trackId, newLabel || null);
        }
      };

      input.addEventListener("blur", commitRename);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.removeEventListener("blur", commitRename);
          input.replaceWith(nameSpan);
          renameBtn.style.display = "";
        }
      });

      nameSpan.replaceWith(input);
      renameBtn.style.display = "none";
      input.focus();
      input.select();
    });

    nameRow.appendChild(renameBtn);

    const details = document.createElement("span");
    details.className = "track-item-details";
    const sizeParts = [];
    if (track.sizeBytes) {
      sizeParts.push(formatBytes(track.sizeBytes));
    }
    if (track.startLat != null && track.startLon != null) {
      sizeParts.push(`${track.startLat.toFixed(2)}, ${track.startLon.toFixed(2)}`);
    }
    if (track.label && track.date) {
      sizeParts.push(dateStr);
    }
    details.textContent = sizeParts.join(" \u00B7 ");

    info.appendChild(nameRow);
    if (sizeParts.length > 0) {
      info.appendChild(details);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-button";
    deleteBtn.textContent = "\u00D7";
    deleteBtn.title = isShared ? "Remove shared track" : "Delete track";
    deleteBtn.addEventListener("click", async () => {
      const msg = isShared
        ? "Remove this shared track from your list?"
        : "Delete this track permanently?";
      if (!confirm(msg)) return;
      try {
        if (isShared) {
          await removeSharedTrack(trackId);
        } else {
          await deleteGPXFromStorage(trackId);
        }
        item.remove();
        if (trackList.children.length === 0) {
          trackList.innerHTML = '<p class="track-empty">No tracks saved.</p>';
        }
      } catch (e) {
        tracksError.textContent = "Failed to delete track: " + e.message;
      }
    });

    item.appendChild(info);
    item.appendChild(deleteBtn);
    return item;
  }

  async function loadTracks() {
    trackList.innerHTML = "";
    tracksError.textContent = "";

    try {
      const [ownTracks, sharedTracks] = await Promise.all([
        getAllStoredGPX(),
        getSharedTracks(),
      ]);

      if (ownTracks.length === 0 && sharedTracks.length === 0) {
        trackList.innerHTML = '<p class="track-empty">No tracks saved.</p>';
        return;
      }

      // Sort each group by date descending (newest first).
      const byDateDesc = (a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date) - new Date(a.date);
      };
      ownTracks.sort(byDateDesc);
      sharedTracks.sort(byDateDesc);

      for (const track of ownTracks) {
        trackList.appendChild(createTrackItem(track, false));
      }

      if (sharedTracks.length > 0 && ownTracks.length > 0) {
        const divider = document.createElement("div");
        divider.className = "track-list-divider";
        divider.textContent = "Shared with me";
        trackList.appendChild(divider);
      }

      for (const track of sharedTracks) {
        trackList.appendChild(createTrackItem(track, true));
      }
    } catch (e) {
      tracksError.textContent = "Failed to load tracks: " + e.message;
    }
  }

  await loadTracks();

  // --- Delete Account ---
  const deleteAccountBtn = document.querySelector("#delete-account-btn");
  const deleteConfirm = document.querySelector("#delete-confirm");
  const deletePasswordInput = document.querySelector("#delete-password");
  const deleteConfirmBtn = document.querySelector("#delete-confirm-btn");
  const deleteCancelBtn = document.querySelector("#delete-cancel-btn");
  const deleteError = document.querySelector("#delete-error");

  deleteAccountBtn.addEventListener("click", () => {
    deleteAccountBtn.style.display = "none";
    deleteConfirm.style.display = "";
  });

  deleteCancelBtn.addEventListener("click", () => {
    deleteConfirm.style.display = "none";
    deleteAccountBtn.style.display = "";
    deletePasswordInput.value = "";
    deleteError.textContent = "";
  });

  deleteConfirmBtn.addEventListener("click", async () => {
    deleteError.textContent = "";
    const password = deletePasswordInput.value;

    if (!password) {
      deleteError.textContent = "Please enter your password.";
      return;
    }

    try {
      await apiDeleteAccount(password);
      window.location.href = "/";
    } catch (e) {
      deleteError.textContent = e.message;
    }
  });
});

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
