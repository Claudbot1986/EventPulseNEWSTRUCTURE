/**
 * Web-shim for react-native-maps.
 *
 * react-native-maps importerar `react-native/Libraries/Utilities/codegenNativeCommands`
 * på modul-top-level, vilket Metro vägrar buntla för web (native-only).
 * Utan shimmen kraschar hela web-builden av EventPulse — även användare
 * som aldrig trycker på Karta-tabben — eftersom Metro för-bundlar alla
 * villkorliga requires.
 *
 * Shimmen:
 *   - Exporterar `MapView` som en View-formad komponent som visar en
 *     "Kartan är inte tillgänglig på webb"-panel. Kartfliken mountar
 *     rent; panelen förklarar varför.
 *   - Exporterar `Marker` (och övriga geometries) som no-op-komponenter.
 *     2026-10-28 — de var tidigare `null`, vilket gjorde att React kastade
 *     "Element type is invalid: expected a string ... but got: null.
 *     Check the render method of `MapScreen`" och kraschade HELA appen så
 *     snart Karta-fliken öppnades (och även NewEventCard:s 📍-knapp).
 *     En komponent som renderar sina barn utan native-stöd är säker: den
 *     renderar inget på kartan men kraschar aldrig.
 *   - Exporterar `PROVIDER_DEFAULT` som `'default'` för API-kompatibilitet.
 *
 * Används av metro.config.js → resolver.extraNodeModules.web['react-native-maps'].
 */

const React = require('react');
const { Text, View, StyleSheet } = require('react-native');

function MapView(props) {
  const { style, children, ...rest } = props || {};
  return React.createElement(
    View,
    { style: [styles.fallback, style], ...rest },
    React.createElement(Text, { style: styles.fallbackTitle }, 'Kartan är inte tillgänglig på webb'),
    React.createElement(Text, { style: styles.fallbackHint }, 'Öppna appen i Expo Go för full kartvy.'),
    children
  );
}

/**
 * No-op geometries. Renderar barnen (t.ex. pin-label) men ingen karta.
 * Får ALDRIG vara null — React kastar då på render och skärmen kraschar.
 */
function NoopGeometry(props) {
  const { children } = props || {};
  return React.createElement(React.Fragment, null, children);
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackTitle: {
    color: '#A9B0BE',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
    textAlign: 'center',
  },
  fallbackHint: {
    color: '#727B8D',
    fontSize: 11,
    textAlign: 'center',
  },
});

module.exports = MapView;
module.exports.default = MapView;
module.exports.Marker = NoopGeometry;
module.exports.PROVIDER_DEFAULT = 'default';
module.exports.Polyline = NoopGeometry;
module.exports.Polygon = NoopGeometry;
module.exports.Circle = NoopGeometry;
module.exports.Callout = NoopGeometry;