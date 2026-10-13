import { getSession } from './storage.js';
export function ownedDraft(id, accountId) {
  const s = getSession(id);
  if (!s || !accountId || s.ownerId !== accountId) throw new Error('הטיוטה לא נמצאה.');
  return s;
}
