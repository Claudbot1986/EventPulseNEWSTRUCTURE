import { SafeAreaView, Text, StyleSheet } from 'react-native';

export default function PlaceholderScreen({ title }) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Kommer snart</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f0f',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#777777',
    fontSize: 15,
  },
});
