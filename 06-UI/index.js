import { registerRootComponent } from 'expo';

// Agent-first product (Phase 1). The legacy browse-first App.js is
// retained on disk but no longer the boot entry. See MASTERPLAN §1, §18.
import App from './App-agent';

registerRootComponent(App);
