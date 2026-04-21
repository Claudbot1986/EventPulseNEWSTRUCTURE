/**
 * EventPulse - Expo App with Local API Server
 * 
 * This version fetches events from a local API server
 * which handles Ticketmaster API calls server-side.
 * 
 * Usage:
 * 1. Start API server: node services/api-server.cjs
 * 2. Start Expo: npx expo start --tunnel
 * 3. Connect from Expo Go
 */

import { useState, useEffect, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, SafeAreaView, ActivityIndicator, TouchableOpacity, ScrollView, Linking, Dimensions } from 'react-native';
import { fetchAllEventsViaServer, checkAPIHealth } from './services/eventServiceClient';

const { width } = Dimensions.get('window');

// Category colors
const CATEGORIES = {
  music: { label: 'MUSIK', color: '#BB86FC', bgColor: '#2D2D3A' },
  culture: { label: 'KULTUR', color: '#4ECDC4', bgColor: '#2D3A35' },
  sports: { label: 'SPORT', color: '#95E1D3', bgColor: '#2D353A' },
  theatre: { label: 'TEATER', color: '#FF6B6B', bgColor: '#3A2A2A' },
  food: { label: 'MAT', color: '#FF7597', bgColor: '#3A2D2D' },
  nightlife: { label: 'NATTLIV', color: '#FFE66D', bgColor: '#3A3A2D' },
};

// Format date
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const daysSwedish = ['Sön', 'Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör'];
  const monthsSwedish = ['jan', 'feb', 'mars', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return `${daysSwedish[date.getDay()]} ${date.getDate()} ${monthsSwedish[date.getMonth()]}`;
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [apiStatus, setApiStatus] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Check API server health on mount
  useEffect(() => {
    async function checkAPI() {
      const status = await checkAPIHealth();
      setApiStatus(status);
      console.log('[App] API Status:', status);
    }
    checkAPI();
  }, []);

  // Fetch events from API server
  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await fetchAllEventsViaServer();
      
      if (result.error) {
        setError(result.error);
        setEvents([]);
      } else {
        setEvents(result.events || []);
        console.log(`[App] Loaded ${result.events?.length || 0} events`);
      }
    } catch (err) {
      setError(err.message);
      setEvents([]);
      console.error('[App] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (apiStatus?.connected) {
      loadEvents();
    }
  }, [apiStatus, loadEvents]);

  // Filter events by category
  const filteredEvents = selectedCategory
    ? events.filter(e => e.source === selectedCategory)
    : events;

  // Group events by date
  const groupedEvents = filteredEvents.reduce((acc, event) => {
    const date = event.date || 'Unknown';
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {});

  const sections = Object.entries(groupedEvents)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 10);

  const renderEvent = ({ item }) => {
    const category = item.source || 'culture';
    const catStyle = CATEGORIES[category] || CATEGORIES.culture;
    
    return (
      <TouchableOpacity 
        style={styles.eventCard}
        onPress={() => item.url && Linking.openURL(item.url)}
      >
        <View style={styles.eventContent}>
          <Text style={styles.eventTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.eventVenue}>{item.venue}</Text>
          <Text style={styles.eventTime}>{item.time || 'TBD'}</Text>
        </View>
        <View style={[styles.sourceBadge, { backgroundColor: catStyle.color }]}>
          <Text style={styles.sourceText}>{category}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // API not connected
  if (!apiStatus?.connected) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🎭 EventPulse</Text>
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>API Server Required</Text>
          <Text style={styles.errorText}>
            Start the API server first:
          </Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeText}>node services/api-server.cjs</Text>
          </View>
          <Text style={styles.errorText}>
            Then reload this app.
          </Text>
          {error && <Text style={styles.errorDetail}>{error}</Text>}
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🎭 EventPulse</Text>
        <Text style={styles.headerSubtitle}>
          {events.length} events from API
        </Text>
      </View>

      {/* Source filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterButton, !selectedCategory && styles.filterButtonActive]}
          onPress={() => setSelectedCategory(null)}
        >
          <Text style={[styles.filterText, !selectedCategory && styles.filterTextActive]}>
            Alla
          </Text>
        </TouchableOpacity>
        {['ticketmaster', 'kulturhuset', 'malmolive'].map(source => (
          <TouchableOpacity
            key={source}
            style={[styles.filterButton, selectedCategory === source && styles.filterButtonActive]}
            onPress={() => setSelectedCategory(source === selectedCategory ? null : source)}
          >
            <Text style={[styles.filterText, selectedCategory === source && styles.filterTextActive]}>
              {source}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#667eea" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadEvents}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sections.flatMap(([date, dayEvents]) => [
            { type: 'header', date, count: dayEvents.length },
            ...dayEvents.map(e => ({ type: 'event', ...e }))
          ])}
          renderItem={({ item, index }) => {
            if (item.type === 'header') {
              return (
                <View style={styles.dateHeader}>
                  <Text style={styles.dateHeaderText}>
                    {formatDate(item.date)} ({item.count})
                  </Text>
                </View>
              );
            }
            return renderEvent({ item, index });
          }}
          keyExtractor={(item, index) => item.id || `item-${index}`}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={loadEvents}
        />
      )}

      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    backgroundColor: '#16213e',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  filterContainer: {
    backgroundColor: '#16213e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 50,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: '#2D2D3A',
  },
  filterButtonActive: {
    backgroundColor: '#667eea',
  },
  filterText: {
    color: '#888',
    fontSize: 14,
  },
  filterTextActive: {
    color: '#fff',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    color: '#888',
    fontSize: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF6B6B',
    marginBottom: 12,
  },
  errorText: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  errorDetail: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  codeBlock: {
    backgroundColor: '#2D2D3A',
    padding: 12,
    borderRadius: 8,
    marginVertical: 12,
  },
  codeText: {
    color: '#667eea',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  retryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContent: {
    padding: 12,
  },
  dateHeader: {
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  dateHeaderText: {
    color: '#667eea',
    fontSize: 16,
    fontWeight: 'bold',
  },
  eventCard: {
    backgroundColor: '#16213e',
    padding: 16,
    borderRadius: 12,
    marginVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventContent: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  eventVenue: {
    fontSize: 14,
    color: '#888',
  },
  eventTime: {
    fontSize: 12,
    color: '#667eea',
    marginTop: 4,
  },
  sourceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    marginLeft: 12,
  },
  sourceText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
});
