export const MAX_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function validateImageUpload(file) {
  if (!file) return 'Please select an image.';
  if (!file.type.startsWith('image/')) return 'Only image files are allowed.';
  if (file.size > MAX_FILE_UPLOAD_BYTES) return 'This image is too large to upload. Choose a smaller image.';
  return '';
}

export function validateProfileImageUpload(file) {
  if (!file) return 'Please select an image.';
  if (!SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase())) {
    return 'Choose a JPEG, PNG, GIF, or WebP image.';
  }
  if (file.size > MAX_FILE_UPLOAD_BYTES) return 'This image is too large to upload. Choose a smaller image.';
  return '';
}
