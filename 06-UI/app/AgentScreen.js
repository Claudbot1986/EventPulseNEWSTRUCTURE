/**
 * EventPulse AgentScreen (Phase 0)
 *
 * Minimal Expo/React Native chat surface that calls the private /agent/chat API.
 * This replaces direct Supabase REST reads in the browse-first UI for the
 * agent-first product path.
 *
 * - No Supabase key access from the screen.
 * - All event data flows through the agent response.
 * - Loading/error/empty states are explicit (per UI rules).
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { chatWithAgent, recordEventInteraction } from '../services/agentClient';

const SUGGESTIONS = [
  'Konsert ikväll',
  'Gratis familj aktivitet',
  'Teater i helgen',
  'Jazz i Stockholm',
];

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EventRow({ card, onInteraction }) {
  const onPress = () => {
    // Best-effort metrics: every tap = click; opening ticket_url = outbound.
    onInteraction?.(card.id, 'click');
    if (card.ticket_url) {
      Linking.openURL(card.ticket_url)
        .then(() => onInteraction?.(card.id, 'outbound'))
        .catch(() => {});
    }
  };
  return (
    <TouchableOpacity onPress={onPress} style={styles.card}>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {card.title || 'Untitled'}
      </Text>
      <Text style={styles.cardMeta}>
        {formatTime(card.start_time)} · {card.venue_name || card.city || 'Stockholm'}
      </Text>
      <Text style={styles.cardFooter}>
        {card.is_free ? 'Gratis' : `${card.price_min_sek ?? '?'}–${card.price_max_sek ?? '?'} SEK`}
      </Text>
    </TouchableOpacity>
  );
}

export default function AgentScreen() {
  const [message, setMessage] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [reply, setReply]       = useState('');
  const [cards, setCards]       = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [history, setHistory]   = useState([]);
  const [questions, setQuestions] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [lastQuery, setLastQuery] = useState('');

  const send = useCallback(async (text) => {
    const m = (text ?? message).trim();
    if (!m || loading) return;
    setLoading(true);
    setError(null);
    setQuestions([]);
    setHistory((h) => [...h, { role: 'user', text: m }]);
    try {
      const res = await chatWithAgent({ message: m });
      setReply(res.reply);
      setCards(res.cards);
      setWarnings(res.warnings);
      setQuestions(res.clarifyingQuestions ?? []);
      setSessionId(res.sessionId);
      setLastQuery(m);
      setHistory((h) => [...h, { role: 'assistant', text: res.reply, cards: res.cards }]);
      setMessage('');
    } catch (err) {
      setError(err && err.message ? err.message : 'unknown error');
    } finally {
      setLoading(false);
    }
  }, [message, loading]);

  // Best-effort interaction tracking. Never throws; server 202 → silent.
  const onInteraction = useCallback((eventId, interaction) => {
    recordEventInteraction({
      eventId,
      interaction,
      sessionId,
      queryText: lastQuery,
    }).catch(() => {});
  }, [sessionId, lastQuery]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <Text style={styles.heading}>EventPulse Agent</Text>

      <FlatList
        data={cards}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <EventRow card={item} onInteraction={onInteraction} />}
        ListHeaderComponent={
          <View>
            {reply ? <Text style={styles.reply}>{reply}</Text> : null}
            {warnings.length > 0 ? (
              <View style={styles.warnings}>
                {warnings.map((w, i) => (
                  <Text key={i} style={styles.warning}>⚠ {w}</Text>
                ))}
              </View>
            ) : null}
            {questions.map((q) => (
              <View key={q.id} style={styles.questionBlock}>
                <Text style={styles.questionText}>{q.text}</Text>
                <View style={styles.chipRow}>
                  {q.options.map((o) => (
                    <TouchableOpacity
                      key={o.value}
                      onPress={() => send(o.value)}
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {loading ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}
            {!loading && !error && cards.length === 0 && reply && questions.length === 0 ? (
              <Text style={styles.empty}>Inga förslag just nu.</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !reply ? (
            <View style={styles.suggestionBox}>
              <Text style={styles.subtle}>Förslag:</Text>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity key={s} onPress={() => send(s)} style={styles.chip}>
                  <Text style={styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null
        }
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Vad vill du göra ikväll?"
          placeholderTextColor="#888"
          editable={!loading}
          onSubmitEditing={() => send()}
        />
        <TouchableOpacity onPress={() => send()} style={styles.sendBtn} disabled={loading || !message.trim()}>
          <Text style={styles.sendText}>Skicka</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', padding: 12 },
  heading: { color: '#fff', fontSize: 20, fontWeight: '600', marginVertical: 8 },
  reply: { color: '#ddd', marginVertical: 8 },
  warning: { color: '#f5a524', fontSize: 12, marginVertical: 1 },
  warnings: { marginVertical: 6 },
  error: { color: '#ff6b6b', marginVertical: 8 },
  empty: { color: '#888', marginVertical: 12, textAlign: 'center' },
  card: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 10,
    marginVertical: 6,
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '500' },
  cardMeta:  { color: '#aaa', fontSize: 13, marginTop: 4 },
  cardFooter:{ color: '#888', fontSize: 12, marginTop: 4 },
  suggestionBox: { marginVertical: 12, flexDirection: 'row', flexWrap: 'wrap' },
  questionBlock: { marginVertical: 8 },
  questionText:  { color: '#ccc', fontSize: 14, marginBottom: 6 },
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    margin: 4,
  },
  chipText: { color: '#fff', fontSize: 13 },
  subtle: { color: '#888', marginBottom: 4, width: '100%' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  sendText: { color: '#fff', fontWeight: '600' },
});
