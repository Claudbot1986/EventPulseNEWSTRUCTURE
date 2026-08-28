# EventPulse UI Design — Benchmark Reference

> Detta dokument är riktmärket för appens visuella design. Token-värden och
> layoutregler här är auktoritativa — kod i `06-UI/` ska spegla dem, och
> framtida ändringar av UI ska utgå från denna specifikation.

Senast verifierad: 2026-08-21 (commit `ff4a0ea`).

---

## 1. Designprinciper

| Princip | Betydelse |
|---|---|
| **Pure black canvas** | Hela appen har `#000000` bakgrund. Inga undantag — inte ens för kort. |
| **Transparent cards** | Kort har `surface: 'transparent'` och enbart en tunn border. Bilden + bakgrunden visar igenom. |
| **Date rows är undantaget** | Dagrubriker (SectionList headers) är de enda ytorna som får ha en egen bakgrundsfärg (`surfaceSoft`). |
| **Inline date clusters** | När ett grupperat event har flera tider, renderas varje tid som en egen gul DateCluster-box **inline i eventHeader**, inte under titeln. |
| **Kompakt typografi** | Mindre text, mer luft. Stora bilder talar. |

---

## 2. Färgtokens (TOKENS.color)

```js
color: {
  appBg:        '#000000',  // canvas — hela appen
  surface:      '#000000',  // samma som canvas
  surfaceRaised:'transparent', // kort och chips — INGEN egen bakgrund
  surfaceSoft:  '#202635',  // ENDAST dagrubriker (SectionList headers)
  border:       '#1A1A1A',  // subtil card border
  borderStrong: '#3A4254',  // tydligare border vid behov
  text:         '#F7F2EA',  // primär text — varmvit
  textMuted:    '#A9B0BE',  // sekundär text
  textSoft:     '#727B8D',  // tertiär text / metadata
  accent:       '#FFB454',  // gul — datum, accent
  accentSoft:   '#332516',  // dämpad gul bakgrund (om någonsin behövs)
  mint:         '#72E0C5',  // pris / bekräftelse
  coral:        '#FF6B8A',  // sekundär accent
  danger:       '#FF7597',  // fel / varning
  black:        '#000000',
  white:        '#FFFFFF',
}
```

**Hård regel:** Inga nya färger utanför denna palett utan uttryckligt beslut.

---

## 3. Kort-mönster (eventCard)

Kort har **ingen egen bakgrund**. Strukturen är:

```
[ eventImage 280px hög, rundade hörn, full bredd ]
[ eventHeader — dateClusters (vänster) + categoryBadge (höger) ]
[ eventTitle ]
[ eventVenue (textMuted) ]
[ eventPrice (mint, liten) ]
```

CSS-mönster:

```js
eventCard: {
  backgroundColor: 'transparent',
  borderRadius: TOKENS.radius.lg,
  borderWidth: 1,
  borderColor: TOKENS.color.border,
  marginBottom: TOKENS.space.md,
  overflow: 'hidden',
}
eventCardBody: {
  padding: TOKENS.space.md,
}
eventHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: TOKENS.space.sm,
  marginBottom: TOKENS.space.sm,
  flexWrap: 'wrap',
}
dateClustersRow: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: TOKENS.space.xs,
  flexShrink: 1,
}
timeClusterWrap: {
  borderRadius: TOKENS.radius.md,
}
```

---

## 4. DateCluster — inline multi-time

När flera events grupperas under samma titel (`groupedEvent.events.length > 1`),
ska varje tidpunkt vara en egen klickbar gul box i `eventHeader`:

```jsx
function DateCluster({ event }) {
  return (
    <View style={styles.dateCluster}>
      <Text style={styles.dateClusterDay}>{formatDate(event.date) || 'Datum saknas'}</Text>
      <Text style={styles.dateClusterTime}>{formatEventTime(event)}</Text>
    </View>
  );
}
```

Rendera i `eventHeader.dateClustersRow`:

```jsx
<View style={styles.eventHeader}>
  <View style={styles.dateClustersRow}>
    {groupedEvent.events.map((event, index) => (
      <TouchableOpacity
        key={`${event.id || event.start_time || index}`}
        style={styles.timeClusterWrap}
        onPress={() => onEventPress(event)}
        activeOpacity={0.7}
      >
        <DateCluster event={event} />
      </TouchableOpacity>
    ))}
  </View>
  <CategoryBadge category={groupedEvent.category} />
</View>
```

**Aldrig:** DateCluster-raden under titeln. Alltid inline i eventHeader, till vänster om CategoryBadge.

---

## 5. Typografi

| Element | Size | Weight | Color |
|---|---|---|---|
| `appTitle` | 34 | 900 | text |
| `dayHeaderText` (SectionList) | 15 | 900 | accent |
| `eventTitle` | 17 | 700 | text |
| `eventVenue` | 12 | 500 | textMuted |
| `eventPrice` | 12 | 700 | mint |
| `dateClusterDay` | 11 | 800 | accent |
| `dateClusterTime` | 10 | 500 | textMuted |

---

## 6. Spacing

| Token | Värde | Användning |
|---|---|---|
| `space.xs` | 4 | gap mellan date clusters |
| `space.sm` | 8 | gap i eventHeader |
| `space.md` | 12 | listContent padding, card marginBottom, cardBody padding |
| `space.lg` | 16 | (reserverad) |

`listContent.padding = TOKENS.space.md`. Korten ligger tätt men andas.

---

## 7. Bildhantering

| Field | Värde |
|---|---|
| Höjd | 280px |
| Bredd | 100% (kortets inre bredd) |
| Resize mode | cover |
| Fallback | `image_url` om null, rendera ingenting (kortet kollapsar inte) |

---

## 8. Kategori-badge

Liten, rundad chip i övre högra hörnet av eventHeader. Bakgrund `transparent`,
text i accent/coral beroende på kategori. Exakt logik finns i `App.js` —
modifiera där, inte här.

---

## 9. Förändringshistorik (2026-08-21)

| Commit | Beskrivning |
|---|---|
| `c32d67c` | revert(06-UI): restore browse-first App.js as Expo entry |
| `c429ff0` | revert(06-UI): revert AgentScreen to pre-Phase-1 UI per user request |
| `8143098` | feat(06-UI): render event image_url in EventRow cards |
| `1d964e9` | style(06-UI): darker bg + bigger images + smaller text in event cards |
| `aff14db` | style(06-UI): pure black bg + larger event images on events list |
| `2e4811a` | style(06-UI): lift card surface so cards are visible on pure black |
| `f422bd6` | style(06-UI): unify surfaceRaised with surface — only date rows stay transparent |
| `3c75765` | style(06-UI): make eventCard transparent — pure black bg shows through |
| `f3c3643` | style(06-UI): subtle border + compact spacing on events list |
| `3eecfb4` | style(06-UI): replace grouped-event time rows with time pills |
| `8d6e455` | style(06-UI): render full DateCluster box per grouped-event time slot |
| `ff4a0ea` | style(06-UI): move grouped-event date clusters inline beside the existing one |

---

## 10. Anti-mönster (det här ska vi INTE göra)

- ❌ Ljusa / höjda kort som syns mot svart bakgrund — kortet ska vara osynligt, bara border + bild.
- ❌ DateCluster-raden under eventTitle — den hör hemma i eventHeader.
- ❌ Date-rubriker med transparent bakgrund — de är de enda ytorna som ska ha en egen färg.
- ❌ Tidvisare bara som tid-pill (utan datum) — använd hela DateCluster (dag + tid).
- ❌ Nya färger utanför paletten.

---

## 11. För framtida ändringar

1. Läs detta dokument först.
2. Gör minsta möjliga diff i `06-UI/App.js` (StyleSheet + komponenter).
3. Verifiera visuellt (Expo Go) innan commit.
4. Uppdatera §9 om commit-listan om ändringen är designmässigt strukturell.

Detta dokument är **inte** ersättning för `MASTERPLAN.md` eller `BACKLOG.md`
— det är ett komplement som låser det visuella språket.
