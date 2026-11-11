const path = require('path');
const { spawnSync } = require('child_process');

const cameraLifecycleChecks = String.raw`
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.argv[1], 'utf8');
const moduleUrl = ` + '`data:text/javascript;base64,${Buffer.from(source).toString(\'base64\')}`' + `;
const { captureImageFromCamera } = await import(moduleUrl);

function createCameraDocument({ deferToBlob = false } = {}) {
  const elements = new Map();
  const windowListeners = new Map();
  let pendingBlobCallback;
  const makeElement = (selector) => ({
    selector,
    listeners: new Map(),
    attributes: new Map(),
    hidden: false,
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    fire(name, event = {}) { this.listeners.get(name)?.({ target: this, ...event }); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    remove() { this.removed = true; },
    querySelector(childSelector) {
      if (!elements.has(childSelector)) elements.set(childSelector, makeElement(childSelector));
      return elements.get(childSelector);
    },
    getContext: () => ({ drawImage() {} }),
    toBlob(callback, type) {
      if (deferToBlob) pendingBlobCallback = () => callback(new Blob(['captured'], { type }));
      else callback(new Blob(['captured'], { type }));
    },
    play: () => Promise.resolve(),
  });
  const dialog = makeElement('dialog');
  const listeners = new Map();
  return {
    body: { appendChild(element) { this.lastElement = element; } },
    createElement: (name) => (name === 'div' ? dialog : makeElement(name)),
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    windowRef: {
      addEventListener: (name, callback) => windowListeners.set(name, callback),
      removeEventListener: (name) => windowListeners.delete(name),
      fire: (name) => windowListeners.get(name)?.(),
    },
    completePendingBlob: () => pendingBlobCallback?.(),
    dialog,
    getElement: (selector) => dialog.querySelector(selector),
  };
}

function createStream() {
  const track = { readyState: 'live', stopCount: 0, stop() { this.stopCount += 1; this.readyState = 'ended'; } };
  return { track, stream: { getTracks: () => [track] } };
}

class TestFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
  }
}

{
  const documentRef = createCameraDocument();
  const { stream, track } = createStream();
  const URLRef = { createObjectURL: () => 'blob:preview', revokeObjectURL: (url) => assert.equal(url, 'blob:preview') };
  const pending = captureImageFromCamera({
    documentRef, mediaDevices: { getUserMedia: async () => stream }, URLRef, FileRef: TestFile,
  });
  await Promise.resolve();
  documentRef.getElement('video').videoWidth = 640;
  documentRef.getElement('video').videoHeight = 480;
  documentRef.getElement('[data-camera-capture]').fire('click');
  assert.equal(documentRef.getElement('img').src, 'blob:preview');
  assert.equal(documentRef.getElement('[data-camera-confirm]').hidden, false);
  assert.equal(track.stopCount, 0, 'capture must wait for user confirmation');
  documentRef.getElement('[data-camera-confirm]').fire('click');
  const file = await pending;
  assert.equal(file.type, 'image/jpeg');
  assert.equal(file.name.startsWith('profile-') && file.name.endsWith('.jpg'), true);
  assert.ok(Number(file.name.slice('profile-'.length, -'.jpg'.length)) > 0);
  assert.equal(track.stopCount, 1);
  assert.equal(documentRef.getElement('video').srcObject, null);
}

{
  const documentRef = createCameraDocument({ deferToBlob: true });
  const { stream, track } = createStream();
  let createdPreview = false;
  const pending = captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => stream },
    URLRef: {
      createObjectURL() { createdPreview = true; return 'blob:late-preview'; },
      revokeObjectURL() {},
    },
    FileRef: TestFile,
    windowRef: documentRef.windowRef,
  });
  await Promise.resolve();
  documentRef.getElement('video').videoWidth = 640;
  documentRef.getElement('video').videoHeight = 480;
  documentRef.getElement('[data-camera-capture]').fire('click');
  documentRef.windowRef.fire('pagehide');
  assert.equal(await pending, null);
  assert.equal(track.stopCount, 1);
  documentRef.completePendingBlob();
  assert.equal(createdPreview, false, 'a late capture callback must not create a preview after cleanup');
}

{
  const documentRef = createCameraDocument();
  const { stream, track } = createStream();
  const pending = captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => stream },
    URLRef: { createObjectURL() {}, revokeObjectURL() {} },
    FileRef: TestFile,
    windowRef: documentRef.windowRef,
  });
  await Promise.resolve();
  documentRef.windowRef.fire('hashchange');
  assert.equal(await pending, null);
  assert.equal(track.stopCount, 1, 'leaving the dashboard must stop the camera tracks');
}

{
  const documentRef = createCameraDocument();
  const { stream, track } = createStream();
  const pending = captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => stream },
    URLRef: { createObjectURL() {}, revokeObjectURL() {} },
    FileRef: TestFile,
  });
  await Promise.resolve();
  documentRef.getElement('[data-camera-cancel]').fire('click');
  assert.equal(await pending, null);
  assert.equal(track.stopCount, 1);
}

{
  const documentRef = createCameraDocument();
  const { stream, track } = createStream();
  const revoked = [];
  const pending = captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => stream },
    URLRef: { createObjectURL: () => 'blob:retake', revokeObjectURL: (url) => revoked.push(url) },
    FileRef: TestFile,
  });
  await Promise.resolve();
  documentRef.getElement('video').videoWidth = 640;
  documentRef.getElement('video').videoHeight = 480;
  documentRef.getElement('[data-camera-capture]').fire('click');
  documentRef.getElement('[data-camera-retake]').fire('click');
  assert.deepEqual(revoked, ['blob:retake']);
  assert.equal(documentRef.getElement('video').hidden, false);
  assert.equal(track.stopCount, 0);
  documentRef.getElement('[data-camera-cancel]').fire('click');
  assert.equal(await pending, null);
  assert.equal(track.stopCount, 1);
}

{
  const documentRef = createCameraDocument();
  const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  await assert.rejects(captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => { throw denied; } },
    URLRef: { createObjectURL() {}, revokeObjectURL() {} },
    FileRef: TestFile,
  }), /Camera access was denied/);
  assert.equal(documentRef.body.lastElement, undefined, 'denied permission must not create a capture dialog');
}

{
  const documentRef = createCameraDocument();
  const missing = Object.assign(new Error('camera missing'), { name: 'NotFoundError' });
  await assert.rejects(captureImageFromCamera({
    documentRef,
    mediaDevices: { getUserMedia: async () => { throw missing; } },
    URLRef: { createObjectURL() {}, revokeObjectURL() {} },
    FileRef: TestFile,
  }), /No camera is available/);
}
`;

test('camera capture supports confirmation, retake, cancellation, and permission errors', () => {
  const helperPath = path.resolve(__dirname, '../frontend/marketing/src/utils/camera-capture.js');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', cameraLifecycleChecks, helperPath], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`Camera lifecycle check failed: ${result.stderr || result.stdout || result.error}`);
  }
});
