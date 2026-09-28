// UtforskaFilterDropdown — kompakt filtermeny för Utforska-flödet.
//
// 2026-09-28: Skriven om från inline-dropdown i App.js efter användarens
// klagomål att "det är väldigt många olika filter". Tre axlar istället för
// fem: När (3 chips), Pris (2 chips), Kategori (8 expanderbara grupper).
// Källa- och Status-sektionerna togs bort (för mycket brus — Källa stöds
// inte ens i search_events API:et och Status "Alla" är en power-user-grej).
// Inga emojis i kategorichips (användarens val 2026-09-27 + 2026-09-28).
//
// Kategori-grupperna ersätter den platta 18-rads-chips-raden. Under varje
// gruppnamn ligger ▾/▴ som visar/döljer underkategorier. Default: alla
// grupper stängda — en sammanfattning av aktiva val finns i headern.
//
// Filterlogiken bor kvar i 06-UI/utils/browseFilters.js (orörd). Denna
// komponent är rent presentationsskikt.

import { Fragment, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Grupperade filterkategorier (2026-09-28). Ersätter den platta
// CATEGORY_FILTERS-listan som fortfarande används av Hem-sidans
// CategoryQuickTilesSection (rör INTE den — emojis där är separata).
//
// 24 fina slugs finns i DB sedan 2026-09-27 (migration
// 20260927-0001-categories-v2.sql). Här mappar vi dem till 8 grupper.
//
// NY: musik-genrer (pop-rock, jazz, classical, electronic, hip-hop, metal,
// world-folk, musical) exponerades inte i tidigare UI men FINNS i DB —
// group 'music' blir deras hem. Den äldre 'music' UI-knappen matchade
// bara events med rå-slug 'music', vilket efter re-tagging (Steg 3.4) blir
// fåtal — användaren får nu istället välja specifik genre.
export const FILTER_CATEGORY_GROUPS = [
  {
    key: 'music',
    labelKey: 'explore.filterGroup.music',
    subcategories: [
      { key: 'pop-rock',    labelKey: 'explore.filterSubcat.popRock' },
      { key: 'jazz',        labelKey: 'explore.filterSubcat.jazz' },
      { key: 'classical',   labelKey: 'explore.filterSubcat.classical' },
      { key: 'electronic',  labelKey: 'explore.filterSubcat.electronic' },
      { key: 'hip-hop',     labelKey: 'explore.filterSubcat.hipHop' },
      { key: 'metal',       labelKey: 'explore.filterSubcat.metal' },
      { key: 'world-folk',  labelKey: 'explore.filterSubcat.worldFolk' },
      { key: 'musical',     labelKey: 'explore.filterSubcat.musical' },
    ],
  },
  {
    key: 'theatre',
    labelKey: 'explore.filterGroup.theatre',
    subcategories: [
      { key: 'opera',           labelKey: 'explore.filterSubcat.opera' },
      { key: 'theatre-comedy',  labelKey: 'explore.filterSubcat.theatreComedy' },
      { key: 'theatre-drama',   labelKey: 'explore.filterSubcat.theatreDrama' },
      { key: 'dance',           labelKey: 'explore.filterSubcat.dance' },
      { key: 'circus',          labelKey: 'explore.filterSubcat.circus' },
    ],
  },
  {
    key: 'exhibition',
    labelKey: 'explore.filterGroup.exhibition',
    subcategories: [
      { key: 'exhibition', labelKey: 'explore.filterSubcat.exhibition' },
    ],
  },
  {
    key: 'food',
    labelKey: 'explore.filterGroup.food',
    subcategories: [
      { key: 'food',          labelKey: 'explore.filterSubcat.food' },
      { key: 'wine-tasting',  labelKey: 'explore.filterSubcat.wineTasting' },
      { key: 'flea-market',   labelKey: 'explore.filterSubcat.fleaMarket' },
    ],
  },
  {
    key: 'kids',
    labelKey: 'explore.filterGroup.kids',
    subcategories: [
      { key: 'kids',   labelKey: 'explore.filterSubcat.kids' },
      { key: 'family', labelKey: 'explore.filterSubcat.family' },
    ],
  },
  {
    key: 'film-learning',
    labelKey: 'explore.filterGroup.filmLearning',
    subcategories: [
      { key: 'film',            labelKey: 'explore.filterSubcat.film' },
      { key: 'talks-lectures',  labelKey: 'explore.filterSubcat.talksLectures' },
      { key: 'workshop',        labelKey: 'explore.filterSubcat.workshop' },
    ],
  },
  {
    key: 'sports',
    labelKey: 'explore.filterGroup.sports',
    subcategories: [
      { key: 'sports', labelKey: 'explore.filterSubcat.sports' },
    ],
  },
  {
    key: 'other',
    labelKey: 'explore.filterGroup.other',
    subcategories: [
      { key: 'community', labelKey: 'explore.filterSubcat.community' },
    ],
  },
];

// Tid (3 chips — "7 dagar" togs bort 2026-09-28 eftersom det överlappar
// med "Helgen" och mest var brus).
const TIME_FILTERS = [
  { key: 'ikvall', labelKey: 'explore.time.ikvall' },
  { key: 'imorgon', labelKey: 'explore.time.imorgon' },
  { key: 'helgen', labelKey: 'explore.time.helgen' },
];

// Pris (2 chips — oförändrat från tidigare).
const PRICE_FILTERS = [
  { key: 'free', labelKey: 'common.free' },
  { key: 'under_200', labelKey: 'explore.price.under200' },
];

function Chip({ active, onPress, label, accessibilityLabel }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryGroupRow({ group, selectedKeys, onToggle, t, expanded, onToggleExpand }) {
  // Antal valda subval i gruppen — visas som liten badge efter gruppnamnet.
  const activeCount = group.subcategories.filter((s) => selectedKeys.includes(s.key)).length;
  const hasActive = activeCount > 0;
  return (
    <Fragment>
      <View style={styles.groupHeader}>
        <Pressable
          onPress={onToggleExpand}
          accessibilityRole="button"
          accessibilityLabel={`${t(group.labelKey)}${hasActive ? `, ${activeCount} valda` : ''}`}
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.groupHeaderBtn, pressed && styles.chipPressed]}
        >
          <Text style={styles.groupChevron}>{expanded ? '▴' : '▾'}</Text>
          <Text style={styles.groupLabel}>{t(group.labelKey)}</Text>
          {hasActive ? (
            <View style={styles.groupBadge}>
              <Text style={styles.groupBadgeText}>{activeCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.subcatRow}>
          {group.subcategories.map((sub) => (
            <Chip
              key={sub.key}
              active={selectedKeys.includes(sub.key)}
              onPress={() => onToggle(sub.key)}
              label={t(sub.labelKey)}
            />
          ))}
        </View>
      ) : null}
    </Fragment>
  );
}

export default function UtforskaFilterDropdown({
  visible,
  timeFilter,
  onTimeFilterChange,
  priceFilter,
  onPriceFilterChange,
  selectedCategories,
  onToggleCategory,
  hasActiveFilters,
  onClearFilters,
  t,
}) {
  // Endast en grupp expanderad åt gången — håller dropdownen kompakt och
  // tvingar fram ett tydligt val. Användaren kan så klart expandera en
  // annan grupp för att byta fokus.
  const [expandedGroup, setExpandedGroup] = useState(null);
  if (!visible) return null;

  return (
    <View style={styles.dropdown}>
      <Text style={styles.sectionLabel}>{t('explore.filter.when')}</Text>
      <View style={styles.chipRow}>
        {TIME_FILTERS.map((f) => (
          <Chip
            key={f.key}
            active={timeFilter === f.key}
            onPress={() => onTimeFilterChange(f.key)}
            label={t(f.labelKey)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('explore.filter.price')}</Text>
      <View style={styles.chipRow}>
        {PRICE_FILTERS.map((f) => (
          <Chip
            key={f.key}
            active={priceFilter === f.key}
            onPress={() => onPriceFilterChange(f.key)}
            label={t(f.labelKey)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>{t('explore.filter.category')}</Text>
      {FILTER_CATEGORY_GROUPS.map((group) => (
        <CategoryGroupRow
          key={group.key}
          group={group}
          selectedKeys={selectedCategories}
          onToggle={onToggleCategory}
          t={t}
          expanded={expandedGroup === group.key}
          onToggleExpand={() => setExpandedGroup((prev) => (prev === group.key ? null : group.key))}
        />
      ))}

      {hasActiveFilters ? (
        <Pressable
          onPress={onClearFilters}
          accessibilityRole="button"
          accessibilityLabel={t('explore.filter.clear')}
          style={({ pressed }) => [styles.clearButton, pressed && styles.chipPressed]}
        >
          <Text style={styles.clearButtonText}>{t('explore.filter.clear')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Tokens hålls inline — komponenten är ensam om sin estetik och lånas
// inte av andra ytor. Färgskala matchar Hem-sidans mörka tema så att
// filtermenyn inte sticker ut.
const styles = StyleSheet.create({
  dropdown: {
    paddingTop: 4,
    paddingBottom: 12,
  },
  sectionLabel: {
    color: '#A9B0BE',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1A1A1A',
  },
  chipActive: {
    backgroundColor: '#FFB454',
  },
  chipPressed: {
    opacity: 0.5,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  groupHeader: {
    marginTop: 4,
  },
  groupHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  groupChevron: {
    color: '#FFB454',
    fontSize: 12,
    fontWeight: '800',
    width: 12,
  },
  groupLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  groupBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFB454',
    marginLeft: 4,
  },
  groupBadgeText: {
    color: '#000000',
    fontSize: 11,
    fontWeight: '800',
  },
  subcatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 18, // indrag under chevron
  },
  clearButton: {
    marginTop: 16,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#1A1A1A',
  },
  clearButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
