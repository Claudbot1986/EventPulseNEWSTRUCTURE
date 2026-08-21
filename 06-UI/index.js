import { registerRootComponent } from 'expo';

// Reverted 2026-08-21: back to browse-first App.js per user request
// (image-list of events, scroll down to see more). The agent-first
// App-agent.js + AgentScreen.js remain on disk for later use.
import App from './App';

registerRootComponent(App);
