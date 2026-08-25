/**
 * Storage för godkända AI-bilder.
 *
 * Sparar base64-bilder + metadata till app:ens documentDirectory,
 * EJ till bundle (skrivskyddad i produktion).
 *
 * Metadata per bild (EU AI Act-compliance):
 *   - aiGenerated: true
 *   - model: 'flux-schnell'
 *   - prompt (full)
 *   - generatedAt (ISO 8601)
 *   - approvedAt (ISO 8601)
 *   - size, styleLabel, eventRef
 */

import * as FileSystem from 'expo-file-system';

const STORAGE_DIR = `${FileSystem.documentDirectory}storage/`;
const STORAGE_FILE = `${STORAGE_DIR}savedImages.json`;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(STORAGE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(STORAGE_DIR, { intermediates: true });
  }
}

async function readExisting() {
  try {
    const content = await FileSystem.readAsStringAsync(STORAGE_FILE);
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.items)) {
      return parsed;
    }
    return { version: 1, savedAt: null, items: [] };
  } catch {
    return { version: 1, savedAt: null, items: [] };
  }
}

export async function saveApprovedImages(approvedImages, eventRef) {
  await ensureDir();
  const existing = await readExisting();

  const newItems = approvedImages.map(img => ({
    id: img.id,
    prompt: img.prompt,
    styleLabel: img.styleLabel,
    eventRef: eventRef
      ? {
          id: eventRef.id,
          source: eventRef.source || null,
          sourceId: eventRef.source_id || null,
          title: eventRef.title_sv || eventRef.title || null,
        }
      : null,
    generatedAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    size: '1024x1024',
    model: 'flux-schnell',
    aiGenerated: true,
    b64: img.b64,
  }));

  const merged = {
    version: 1,
    savedAt: new Date().toISOString(),
    items: [...existing.items, ...newItems],
  };

  await FileSystem.writeAsStringAsync(STORAGE_FILE, JSON.stringify(merged, null, 2));

  return {
    added: newItems.length,
    total: merged.items.length,
    path: STORAGE_FILE,
  };
}

export async function listSavedImages() {
  const existing = await readExisting();
  return existing.items || [];
}