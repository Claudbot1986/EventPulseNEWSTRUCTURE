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

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  chatWithAgent,
  recordEventInteraction,
  followEntity,
  getFollowedEntities,
} from '../services/agentClient';
import { resolveReasons } from '../utils/rankReasonLabels';

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

const REASONS_VISIBLE_DEFAULT = 3;

/**
 * Inline reason chips for one card. Per vault 40-UX-Research-Decisions:
 *   - icon + short label, max 2-3 visible, "visa mer" if more.
 *   - Never free text. Tap on a chip is a no-op (no hidden critical info).
 *
 * Resolved labels come from utils/rankReasonLabels — never inline strings.
 */
function ReasonChips({ reasons }) {
  const [expanded, setExpanded] = useState(false);
  // Phase 0 is sv-only; explicit 'sv' keeps the helper honest.
  const resolved = resolveReasons(reasons, 'sv');
  if (resolved.length === 0) return null;

  const visible = expanded ? resolved : resolved.slice(0, REASONS_VISIBLE_DEFAULT);
  const hidden = resolved.length - visible.length;

  return (
    <View style={styles.reasonRow}>
      {visible.map((r) => (
        <View key={r.key} style={styles.reasonChip} accessibilityLabel={r.fullLabel}>
          <Text style={styles.reasonChipText}>{r.icon} {r.label}</Text>
        </View>
      ))}
      {hidden > 0 ? (
        <TouchableOpacity
          onPress={() => setExpanded(true)}
          style={styles.reasonMore}
          accessibilityRole="button"
        >
          <Text style={styles.reasonMoreText}>+{hidden} visa mer</Text>
        </TouchableOpacity>
      ) : expanded && resolved.length > REASONS_VISIBLE_DEFAULT ? (
        <TouchableOpacity
          onPress={() => setExpanded(false)}
          style={styles.reasonMore}
          accessibilityRole="button"
        >
          <Text style={styles.reasonMoreText}>visa mindre</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function EventRow({ card, onInteraction, onVenueLongPress, isFollowingVenue }) {
  const onPress = () => {
    // Best-effort metrics: every tap = click; opening ticket_url = outbound.
    onInteraction?.(card.id, 'click');
    if (card.ticket_url) {
      Linking.openURL(card.ticket_url)
        .then(() => onInteraction?.(card.id, 'outbound'))
        .catch(() => {});
    }
  };
  // The venue line is its own TouchableOpacity so a long-press reaches
  // onVenueLongPress WITHOUT triggering the card-level onPress (which would
  // open ticket_url). `hitSlop` enlarges the tap area to the meta line so a
  // long-press near the venue label is still registered.
  const showFollowStar = isFollowingVenue && !!card.venue_id;
  return (
    <TouchableOpacity onPress={onPress} style={styles.card}>
      {card.image_url ? (
        <View style={styles.cardImageWrap}>
          <Image
            source={{ uri: card.image_url }}
            style={styles.cardImage}
            accessibilityLabel={card.title}
          />
          {card.image_license && card.image_license !== 'pressbild' && card.image_license !== 'unknown' ? (
            <View style={styles.imageAttribution}>
              <Text style={styles.imageAttributionText} numberOfLines={1}>
                {card.image_attribution || (card.image_license === 'cc-by' ? 'CC BY' : 'Photo')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {card.title || 'Untitled'}
        </Text>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>
            {formatTime(card.start_time)} · {card.venue_name || card.city || 'Stockholm'}
          </Text>
          <TouchableOpacity
            onPress={() => onVenueLongPress?.(card)}
            onLongPress={() => onVenueLongPress?.(card)}
            delayLongPress={350}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            accessibilityRole="button"
            accessibilityLabel={
              card.venue_id
                ? (showFollowStar ? 'Sluta följ ' + card.venue_name : 'Följ ' + card.venue_name)
                : card.venue_name || 'Plats'
            }
            disabled={!card.venue_id}
            style={styles.followTap}
          >
            <Text style={styles.followStar}>
              {showFollowStar ? '★' : (card.venue_id ? '☆' : '')}
            </Text>
          </TouchableOpacity>
        </View>
        <ReasonChips reasons={card.reasons} />
        <Text style={styles.cardFooter}>
          {card.is_free ? 'Gratis' : `${card.price_min_sek ?? '?'}–${card.price_max_sek ?? '?'} SEK`}
        </Text>
      </View>
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
  // T0050 — followed venues. Refreshed on mount and after every toggle so
  // the long-press action sheet always knows whether to show "Följ" or
  // "Sluta följ". Stored as a Set for O(1) lookup inside FlatList render.
  const [followedVenueIds, setFollowedVenueIds] = useState(() => new Set());

  const refreshFollowed = useCallback(async () => {
    try {
      const res = await getFollowedEntities({ timeoutMs: 4_000 });
      if (res && res.ok) {
        setFollowedVenueIds(new Set(res.venueIds));
      }
      // Silent on failure — long-press defaults to "Följ" until proven otherwise.
    } catch (_err) {
      // Never throw into the chat path.
    }
  }, []);

  // Refresh on mount; cheap (single GET, cached on the server for 5 min).
  useEffect(() => {
    refreshFollowed();
  }, [refreshFollowed]);

  const onVenueLongPress = useCallback((card) => {
    if (!card || !card.venue_id) return;
    const venueId = card.venue_id;
    const venueName = card.venue_name || 'Plats';
    const isFollowing = followedVenueIds.has(venueId);
    const followLabel = isFollowing ? 'Sluta följ' : 'Följ';
    const confirmLabel = isFollowing ? 'Sluta följa' : 'Följ';
    const cancelLabel = 'Avbryt';
    const destructive = isFollowing;
    // iOS: native ActionSheet (Phase 0 UI). Android: Alert fallback so the
    // affordance is reachable on both platforms without a third-party lib.
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: venueName,
          message: isFollowing
            ? 'Du följer den här platsen. Fler events från den prioriteras i sökresultaten.'
            : 'Fler events från den här platsen prioriteras i sökresultaten.',
          options: [cancelLabel, confirmLabel],
          cancelButtonIndex: 0,
          destructiveButtonIndex: destructive ? 1 : -1,
        },
        async (idx) => {
          if (idx === 1) {
            const action = isFollowing ? 'unfollow' : 'follow';
            const res = await followEntity({
              entityType: 'venue',
              entityId: venueId,
              action,
            });
            if (res && res.ok) {
              setFollowedVenueIds((prev) => {
                const next = new Set(prev);
                if (action === 'follow') next.add(venueId);
                else next.delete(venueId);
                return next;
              });
            } else if (res && res.warning) {
              Alert.alert('Kunde inte spara', res.warning);
            }
          }
        }
      );
    } else {
      Alert.alert(
        venueName,
        isFollowing
          ? 'Du följer den här platsen. Vill du sluta följa?'
          : 'Vill du följa den här platsen? Fler events prioriteras i sökresultaten.',
        [
          { text: cancelLabel, style: 'cancel' },
          {
            text: confirmLabel,
            style: destructive ? 'destructive' : 'default',
            onPress: async () => {
              const action = isFollowing ? 'unfollow' : 'follow';
              const res = await followEntity({
                entityType: 'venue',
                entityId: venueId,
                action,
              });
              if (res && res.ok) {
                setFollowedVenueIds((prev) => {
                  const next = new Set(prev);
                  if (action === 'follow') next.add(venueId);
                  else next.delete(venueId);
                  return next;
                });
              } else if (res && res.warning) {
                Alert.alert('Kunde inte spara', res.warning);
              }
            },
          },
        ]
      );
    }
  }, [followedVenueIds]);

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
        renderItem={({ item }) => (
          <EventRow
            card={item}
            onInteraction={onInteraction}
            onVenueLongPress={onVenueLongPress}
            isFollowingVenue={!!item.venue_id && followedVenueIds.has(item.venue_id)}
          />
        )}
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
    borderRadius: 10,
    marginVertical: 6,
    overflow: 'hidden',
  },
  cardImage: {
    width: '100%',
    height: 160,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: '#252525',
  },
  cardImageWrap: {
    position: 'relative',
  },
  imageAttribution: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    maxWidth: '70%',
  },
  imageAttributionText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '500',
  },
  cardBody: {
    padding: 12,
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '500' },
  cardMeta:  { color: '#aaa', fontSize: 13, marginTop: 4 },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  followTap: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 4,
  },
  followStar: {
    color: '#f5a524',
    fontSize: 14,
  },
  cardFooter:{ color: '#888', fontSize: 12, marginTop: 4 },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  reasonChip: {
    backgroundColor: '#252525',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 4,
    marginBottom: 4,
  },
  reasonChipText: { color: '#ccc', fontSize: 11 },
  reasonMore: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 4,
  },
  reasonMoreText: { color: '#7aa2f7', fontSize: 11 },
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
