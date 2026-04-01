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

  async function loadTracks() {
    trackList.innerHTML = "";
    tracksError.textContent = "";

    try {
      const tracks = await getAllStoredGPX();

      if (tracks.length === 0) {
        trackList.innerHTML = '<p class="track-empty">No tracks saved.</p>';
        return;
      }

      // Sort by date descending (newest first).
      tracks.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date) - new Date(a.date);
      });

      for (const track of tracks) {
        const item = document.createElement("div");
        item.className = "track-item";

        const info = document.createElement("div");
        info.className = "track-item-info";

        const date = document.createElement("span");
        date.className = "track-item-date";
        date.textContent = track.date
          ? new Date(track.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
          : "Unknown date";

        const details = document.createElement("span");
        details.className = "track-item-details";
        const sizeParts = [];
        if (track.sizeBytes) {
          sizeParts.push(formatBytes(track.sizeBytes));
        }
        if (track.startLat != null && track.startLon != null) {
          sizeParts.push(`${track.startLat.toFixed(2)}, ${track.startLon.toFixed(2)}`);
        }
        details.textContent = sizeParts.join(" \u00B7 ");

        info.appendChild(date);
        if (sizeParts.length > 0) {
          info.appendChild(document.createTextNode(" \u2014 "));
          info.appendChild(details);
        }

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-button";
        deleteBtn.textContent = "\u00D7";
        deleteBtn.title = "Delete track";
        deleteBtn.addEventListener("click", async () => {
          if (!confirm("Delete this track permanently?")) return;
          try {
            await deleteGPXFromStorage(track.id);
            item.remove();
            // Check if list is now empty.
            if (trackList.children.length === 0) {
              trackList.innerHTML = '<p class="track-empty">No tracks saved.</p>';
            }
          } catch (e) {
            tracksError.textContent = "Failed to delete track: " + e.message;
          }
        });

        item.appendChild(info);
        item.appendChild(deleteBtn);
        trackList.appendChild(item);
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
