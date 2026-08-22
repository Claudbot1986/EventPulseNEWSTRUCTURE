/**
 * NetworkContext — global connectivity state for the EventPulse app.
 *
 * Polls GET /agent/health every 30 s. Any successful API call via
 * `markOnline()` also resets the offline state immediately so the banner
 * disappears on the first successful request rather than waiting for the
 * next poll tick.
 *
 * T0073 — MVP-gap network resilience.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const NetworkContext = createContext({
  isConnected: true,
  markOnline: () => {},
});

export function NetworkProvider({ children }) {
  const [isConnected, setIsConnected] = useState(true);
  const intervalRef = useRef(null);

  const markOnline = () => setIsConnected(true);

  useEffect(() => {
    setMarkOnline(() => setIsConnected(true));
    return () => setMarkOnline(() => {});
  }, []);

  useEffect(() => {
    // Poll every 30 seconds.
    // Dynamic import: agentClient.js imports markOnline from this file.
    // A static import here creates a require cycle that leaves
    // `useNetworkContext` uninitialized on Expo Go (Hermes
    // "Property 'useNetworkContext' doesn't exist" → red screen).
    const check = async () => {
      try {
        const { getAgentHealth } = await import('./agentClient');
        const ok = await getAgentHealth();
        if (ok) setIsConnected(true);
        else setIsConnected(false);
      } catch {
        setIsConnected(false);
      }
    };

    check(); // immediate first check
    intervalRef.current = setInterval(check, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ isConnected, markOnline }}>
      {children}
    </NetworkContext.Provider>
  );
}

/**
 * Call this in every API wrapper (fetchFeed, chatWithAgent, etc.) after a
 * successful response so the offline banner disappears immediately.
 *
 * Usage in agentClient.js:
 *   import { markOnline } from './networkContext';
 *   // after a successful fetch:
 *   markOnline();
 *
 * Note: Because agentClient.js is a plain module (not a React component),
 * we expose markOnline via a singleton ref set by the NetworkProvider.
 */
let _markOnline = () => {};
export function setMarkOnline(fn) {
  _markOnline = fn;
}
export function markOnline() {
  _markOnline();
}

export function useNetworkContext() {
  return useContext(NetworkContext);
}
