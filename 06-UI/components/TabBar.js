import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

const TABS = [
  { key: 'hem', label: 'Hem', icon: '⌂' },
  { key: 'utforska', label: 'Utforska', icon: '◎' },
  { key: 'notiser', label: 'Notiser', icon: '◔' },
  { key: 'profil', label: 'Profil', icon: '◌' },
];

export default function TabBar({ activeTab, onTabChange }) {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabChange(tab.key)}
            activeOpacity={0.8}
          >
            <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
              <Text style={[styles.icon, active && styles.iconActive]}>{tab.icon}</Text>
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
            {active ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1f1f1f',
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: '#FFFFFF',
  },
  icon: {
    color: '#888888',
    fontSize: 18,
  },
  iconActive: {
    color: '#0f0f0f',
  },
  label: {
    color: '#777777',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '500',
  },
  labelActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#E8A838',
    marginTop: 4,
  },
  dotSpacer: {
    width: 5,
    height: 5,
    marginTop: 4,
  },
});
