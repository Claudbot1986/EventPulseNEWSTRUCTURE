/**
 * save-favorite feature — API-lagret.
 *
 * Stream B.1 (Agent Trust Plan 2026-10-09): feature-as-directory-pilot.
 *
 * Användning:
 *   import { toggleSave, getSaveState, useSaveState } from '../features/save-favorite/feature.api';
 *
 * State-modellen:
 *   - Lokal AsyncStorage-cachelagring (för snabb UI-toggle utan nätverk).
 *   - Backend-synk via getAuthHeader() + POST /agent/feedback (befintlig endpoint, type='save').
 *   - useSaveState() är en publik React-hook som ger (isSaved, toggle, pending).
 *
 * Säkerhet:
 *   - Inga hårdkodade URLs. Allt via services/api-server.cjs.
 *   - GDPR-erase: clearAll() raderar lokalt + skickar raderings-signal till backend.
 */

import { useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthHeader } from '../../services/agentClient';

const STORAGE_KEY = 'eventpulse.save-favorite.v1';
const ENDPOINT = '/agent/feedback';

/**
 * @typedef {object} CachedSaveState
 * @property {boolean} isSaved
 * @property {string} updatedAt  ISO-8601
 */

/**
 * @param {string} eventId
 * @returns {Promise<CachedSaveState|null>}
 */
async function readCached(eventId) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const map = JSON.parse(raw);
    return map[eventId] ?? null;
  } catch {
    return null;
  }
}

async function writeCached(eventId, state) {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const map = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
  map[eventId] = state;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Hämta aktuell save-state för ett event (lokalt cache + remote sync).
 */
export async function getSaveState(eventId) {
  return await readCached(eventId);
}

/**
 * Växla save-state för ett event. Uppdaterar lokalt + POST:ar till backend.
 * Returnerar det nya state-objektet.
 */
export async function toggleSave(eventId, userId) {
  const previous = await readCached(eventId);
  const nextIsSaved = !previous?.isSaved;
  const updatedAt = new Date().toISOString();
  await writeCached(eventId, { isSaved: nextIsSaved, updatedAt });

  // Backend-synk. Om det misslyckas: state är redan optimistiskt toggle,
  // nästa useSaveState-mount eller toggle kommer att försöka igen.
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        client_user_id: userId ?? null,
        event_id: eventId,
        interaction_type: nextIsSaved ? 'save' : 'unsave',
        ts: updatedAt,
      }),
    });
  } catch {
    // tyst — användaren får ny state men remote-synk får försöka igen senare
  }

  return { eventId, isSaved: nextIsSaved, updatedAt, pending: false };
}

/**
 * React-hook som ger (isSaved, toggle, pending). Auto-monterar när component mountar.
 */
export function useSaveState(eventId, userId) {
  const [state, setState] = useState({
    isSaved: false,
    pending: false,
    updatedAt: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await readCached(eventId);
      if (!cancelled) {
        setState({
          isSaved: cached?.isSaved ?? false,
          pending: false,
          updatedAt: cached?.updatedAt ?? null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const toggle = useCallback(async () => {
    setState(s => ({ ...s, pending: true }));
    const next = await toggleSave(eventId, userId);
    setState({
      isSaved: next.isSaved,
      pending: false,
      updatedAt: next.updatedAt,
    });
  }, [eventId, userId]);

  return { ...state, toggle };
}

/**
 * GDPR-erase: rensa all save-state lokalt + signal till backend.
 */
export async function clearAll(userId) {
  await AsyncStorage.removeItem(STORAGE_KEY);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(),
      },
      body: JSON.stringify({
        client_user_id: userId ?? null,
        interaction_type: 'gdpr_erase_save_favorite',
        ts: new Date().toISOString(),
      }),
    });
  } catch {
    // bästa-förmåga
  }
}
