# components/

Här bygger du UI-komponenter i isolering. Importera dem i `App.js` för test.

## Konventioner

- Inga providers, ingen auth, inga services.
- Använd `useState` för lokal state (Zustand/Redux kräver godkännande).
- När komponenten är klar → kopiera in i `06-UI/components/`.

## Exempel

```js
// components/MyButton.js
import { TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function MyButton({ label, onPress }) {
  return (
    <TouchableOpacity style={styles.btn} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { backgroundColor: '#FFB454', padding: 12, borderRadius: 999 },
  label: { color: '#000000', fontWeight: '900' },
});
```

Importera i App.js:

```js
import MyButton from './components/MyButton';
```