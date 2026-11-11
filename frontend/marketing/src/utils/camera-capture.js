function stopCameraStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    if (track.readyState !== 'ended') track.stop();
  }
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

export async function captureImageFromCamera({
  documentRef = globalThis.document,
  mediaDevices = globalThis.navigator?.mediaDevices,
  URLRef = globalThis.URL,
  FileRef = globalThis.File,
  windowRef = globalThis.window,
} = {}) {
  if (!documentRef?.body || !mediaDevices?.getUserMedia || !FileRef) {
    throw new Error('Live camera capture is not supported in this browser. Use the photo upload option instead.');
  }

  let stream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user' },
    });
  } catch (error) {
    const message = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError'
      ? 'Camera access was denied. Allow camera access or use the photo upload option.'
      : error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError'
        ? 'No camera is available. Use the photo upload option instead.'
        : 'Unable to open the camera. Use the photo upload option instead.';
    throw new Error(message, { cause: error });
  }

  return new Promise((resolve, reject) => {
    const dialog = documentRef.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Capture profile photo');
    dialog.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4';
    dialog.innerHTML = `
      <section class="w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl">
        <h2 class="text-xl font-semibold text-slate-900">Capture profile photo</h2>
        <video class="mt-4 max-h-[60vh] w-full rounded-2xl bg-slate-950 object-contain" autoplay playsinline muted></video>
        <img class="mt-4 hidden max-h-[60vh] w-full rounded-2xl bg-slate-100 object-contain" alt="Captured photo preview" />
        <p data-camera-message class="mt-3 text-sm text-rose-700" role="status" aria-live="polite"></p>
        <div class="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" data-camera-cancel class="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700">Cancel</button>
          <button type="button" data-camera-retake hidden class="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700">Retake</button>
          <button type="button" data-camera-capture class="rounded-full bg-sky-600 px-4 py-2 font-semibold text-white">Take photo</button>
          <button type="button" data-camera-confirm hidden class="rounded-full bg-emerald-600 px-4 py-2 font-semibold text-white">Use photo</button>
        </div>
      </section>
    `;

    const video = dialog.querySelector('video');
    const preview = dialog.querySelector('img');
    const canvas = documentRef.createElement('canvas');
    const captureButton = dialog.querySelector('[data-camera-capture]');
    const retakeButton = dialog.querySelector('[data-camera-retake]');
    const confirmButton = dialog.querySelector('[data-camera-confirm]');
    const cancelButton = dialog.querySelector('[data-camera-cancel]');
    let capturedBlob = null;
    let previewUrl = null;
    let settled = false;

    const cleanup = () => {
      stopCameraStream(stream);
      video.srcObject = null;
      if (previewUrl) URLRef.revokeObjectURL(previewUrl);
      documentRef.removeEventListener('keydown', onKeyDown);
      windowRef?.removeEventListener('hashchange', onNavigation);
      windowRef?.removeEventListener('pagehide', onNavigation);
      dialog.remove();
    };

    const finish = (file) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish(null);
    };
    const onNavigation = () => finish(null);

    const retake = () => {
      capturedBlob = null;
      if (previewUrl) URLRef.revokeObjectURL(previewUrl);
      previewUrl = null;
      preview.removeAttribute('src');
      setVisible(preview, false);
      setVisible(video, true);
      setVisible(captureButton, true);
      setVisible(retakeButton, false);
      setVisible(confirmButton, false);
    };

    captureButton.addEventListener('click', () => {
      if (!video.videoWidth || !video.videoHeight) {
        dialog.querySelector('[data-camera-message]').textContent = 'The camera is still starting. Try again in a moment.';
        return;
      }

      try {
        const scale = Math.min(1, 1280 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo canvas is unavailable.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (settled) return;
          if (!blob) {
            dialog.querySelector('[data-camera-message]').textContent = 'The photo could not be captured. Please try again.';
            return;
          }
          try {
            capturedBlob = blob;
            previewUrl = URLRef.createObjectURL(blob);
            preview.src = previewUrl;
            setVisible(video, false);
            setVisible(preview, true);
            setVisible(captureButton, false);
            setVisible(retakeButton, true);
            setVisible(confirmButton, true);
            dialog.querySelector('[data-camera-message]').textContent = 'Review the photo, retake it, or choose Use photo to continue.';
          } catch (error) {
            fail(new Error('The captured photo preview could not be opened.', { cause: error }));
          }
        }, 'image/jpeg', 0.9);
      } catch (error) {
        dialog.querySelector('[data-camera-message]').textContent = error.message || 'The photo could not be captured. Please try again.';
      }
    });

    retakeButton.addEventListener('click', retake);
    confirmButton.addEventListener('click', () => {
      if (!capturedBlob) return;
      try {
        finish(new FileRef([capturedBlob], `profile-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      } catch (error) {
        fail(new Error('The captured photo could not be prepared for upload.', { cause: error }));
      }
    });
    cancelButton.addEventListener('click', () => finish(null));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null);
    });
    documentRef.addEventListener('keydown', onKeyDown);
    windowRef?.addEventListener('hashchange', onNavigation);
    windowRef?.addEventListener('pagehide', onNavigation);
    documentRef.body.appendChild(dialog);
    video.srcObject = stream;
    try {
      Promise.resolve(video.play()).catch((error) => fail(new Error('Unable to start the camera preview. Use the photo upload option instead.', { cause: error })));
    } catch (error) {
      fail(new Error('Unable to start the camera preview. Use the photo upload option instead.', { cause: error }));
    }
  });
}
