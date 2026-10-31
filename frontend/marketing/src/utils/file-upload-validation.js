export const MAX_FILE_UPLOAD_BYTES = 20 * 1024 * 1024;

export function validateImageUpload(file) {
  if (!file) return 'Please select an image.';
  if (!file.type.startsWith('image/')) return 'Only image files are allowed.';
  if (file.size > MAX_FILE_UPLOAD_BYTES) return 'This image is too large to upload. Choose a smaller image.';
  return '';
}
