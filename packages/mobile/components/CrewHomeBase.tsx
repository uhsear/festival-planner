import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCrewStore } from '@festie/shared/stores';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import Button from './Button';

interface CrewHomeBaseProps {
  crewId: string;
  location: string | null | undefined;
  time: string | null | undefined;
  isOwner: boolean;
}

/**
 * Crew home base — the spot the crew rallies at. Mirrors web HomeBaseCard:
 * owners get an inline edit (location + optional time); non-owners see it
 * read-only; the card is hidden entirely when there is nothing to show and the
 * viewer can't edit. Reads current values from the active crew (server
 * normalizes them onto the crew object), writes via the shared updateHomeBase.
 */
export default function CrewHomeBase({ crewId, location, time, isOwner }: CrewHomeBaseProps) {
  const t = useTokens();
  const styles = useStyles();
  const updateHomeBase = useCrewStore((s) => s.updateHomeBase);

  const [editing, setEditing] = useState(false);
  const [loc, setLoc] = useState(location ?? '');
  const [timeValue, setTimeValue] = useState(time ?? '');
  const [saving, setSaving] = useState(false);
  const [focusedField, setFocusedField] = useState<'location' | 'time' | null>(null);

  // Keep the form in sync when the crew's stored values change underneath us.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync the edit form when stored values change underneath
    setLoc(location ?? '');
    setTimeValue(time ?? '');
  }, [location, time]);

  const hasHomeBase = !!location;

  if (!hasHomeBase && !isOwner) return null;

  const handleSave = async () => {
    const trimmed = loc.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await updateHomeBase(crewId, {
        location: trimmed,
        time: timeValue.trim() || null,
      });
      setEditing(false);
    } catch {
      // Error is surfaced via the crew store.
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <View style={styles.editBox}>
        <View style={styles.editHeader}>
          <Ionicons name="location" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.editTitle}>Set home base</Text>
          <TouchableOpacity
            onPress={() => setEditing(false)}
            style={styles.iconButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing home base"
          >
            <Ionicons name="close" size={18} color={t.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <TextInput
          style={[styles.input, focusedField === 'location' && styles.inputFocused]}
          placeholder="Where should the crew meet?"
          placeholderTextColor={t.colors.text.placeholder}
          value={loc}
          onChangeText={setLoc}
          maxLength={200}
          onFocus={() => setFocusedField('location')}
          onBlur={() => setFocusedField((f) => (f === 'location' ? null : f))}
          accessibilityLabel="Home base location"
        />
        <TextInput
          style={[styles.input, focusedField === 'time' && styles.inputFocused]}
          placeholder="Time (optional, e.g. 6:00 PM)"
          placeholderTextColor={t.colors.text.placeholder}
          value={timeValue}
          onChangeText={setTimeValue}
          maxLength={100}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          onFocus={() => setFocusedField('time')}
          onBlur={() => setFocusedField((f) => (f === 'time' ? null : f))}
          accessibilityLabel="Home base time"
        />
        <Button
          label="Save"
          loading={saving}
          loadingLabel="Saving…"
          disabled={!loc.trim()}
          onPress={handleSave}
          accessibilityLabel="Save home base"
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.card, hasHomeBase ? styles.cardSet : styles.cardEmpty]}
      onPress={() => {
        if (isOwner) setEditing(true);
      }}
      disabled={!isOwner}
      activeOpacity={isOwner ? 0.8 : 1}
      accessibilityRole={isOwner ? 'button' : 'text'}
      accessibilityLabel={hasHomeBase ? `Home base ${location}${time ? ` at ${time}` : ''}` : 'Set crew home base'}
    >
      <Ionicons name="location" size={16} color={hasHomeBase ? t.colors.accent.aqua : t.colors.text.muted} />
      <View style={styles.cardInfo}>
        {hasHomeBase ? (
          <View style={styles.cardRow}>
            <Text style={styles.cardLocation} numberOfLines={1}>
              {location}
            </Text>
            {time ? <Text style={styles.cardTime}>{time}</Text> : null}
          </View>
        ) : (
          <Text style={styles.cardPlaceholder}>Tap to set a home base</Text>
        )}
      </View>
      {isOwner ? <Ionicons name="pencil" size={14} color={t.colors.text.secondary} /> : null}
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    backgroundColor: t.colors.bg.secondary,
  },
  cardSet: {
    borderColor: t.colors.accent.aqua,
  },
  cardEmpty: {
    borderColor: t.colors.border.default,
    borderStyle: 'dashed',
  },
  cardInfo: {
    flex: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  cardLocation: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  cardTime: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  cardPlaceholder: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  editBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  editTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  iconButton: {
    padding: t.spacing[1],
    // WCAG 2.5.5 / Apple HIG >=44pt touch target for these small (16-18px)
    // icon-only controls — padding alone can't reach it.
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
}));
