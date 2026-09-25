import { registerRootComponent } from 'expo';
import App from './App';

// 06-UI-sandbox: minimal Expo-app för UI-iteration. Egen bundle, eget schema,
// eget bundle-identifier — delas INTE med 06-UI/. Hela syftet är att kunna
// ladda om UI-komponenter utan att dra in AppShell, App.js, providers eller
// services som finns i 06-UI/App.js (~2500 rader).
registerRootComponent(App);