import { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

/**
 * Pure-RN form primitives for the admin edit surfaces. NO native module — every
 * picker is a core <Modal>, every field a token-styled <TextInput>. This keeps
 * the whole admin write surface OTA-able (no datetimepicker / color-picker
 * native deps). All inputs follow the focus affordance from the Account inline
 * sections (accent border + subtle aqua ring on focus).
 */

// ---------------------------------------------------------------------------
// LabeledTextInput — a labeled, focus-aware text field with optional hint/error.
// ---------------------------------------------------------------------------

export interface LabeledTextInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | null;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'url';
  maxLength?: number;
  editable?: boolean;
  multiline?: boolean;
  accessibilityLabel?: string;
}

export function LabeledTextInput({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  autoCapitalize = 'sentences',
  keyboardType = 'default',
  maxLength,
  editable = true,
  multiline = false,
  accessibilityLabel,
}: LabeledTextInputProps) {
  const t = useTokens();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, focused && styles.inputFocused]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.colors.text.placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={editable}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={accessibilityLabel ?? label}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ModalSelect — tap to open a RN <Modal> list of options (stage / timezone etc).
// ---------------------------------------------------------------------------

export interface SelectOption {
  label: string;
  value: string;
}

export interface ModalSelectProps {
  label: string;
  value: string | null;
  options: SelectOption[];
  onSelect: (value: string) => void;
  placeholder?: string;
  hint?: string;
  editable?: boolean;
}

export function ModalSelect({
  label,
  value,
  options,
  onSelect,
  placeholder = 'Select…',
  hint,
  editable = true,
}: ModalSelectProps) {
  const t = useTokens();
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, styles.selectRow, !editable && styles.inputDisabled]}
        onPress={() => editable && setOpen(true)}
        activeOpacity={0.7}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={selected ? styles.selectValue : styles.selectPlaceholder} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={t.iconSize.sm} color={t.colors.text.placeholder} />
      </TouchableOpacity>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Dismiss picker">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              {label}
            </Text>
            <ScrollView style={styles.sheetList} showsVerticalScrollIndicator={false}>
              {options.map((opt) => {
                const isActive = opt.value === value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={styles.optionRow}
                    onPress={() => {
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ selected: isActive }}
                  >
                    <Text style={[styles.optionLabel, isActive && styles.optionLabelActive]} numberOfLines={1}>
                      {opt.label}
                    </Text>
                    {isActive ? (
                      <Ionicons name="checkmark" size={t.iconSize.md} color={t.colors.accent.aqua} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// HexColorField — text input for a #RRGGBB value + a tappable swatch grid drawn
// from the app's stage/brand palette. NO native color picker.
// ---------------------------------------------------------------------------

/**
 * The stage-color preset palette. The web admin uses a free color input with no
 * fixed presets, so these presets are assembled from the app's own documented
 * token hues (brand aqua/coral, the priority + status functional colors, and
 * the accessible stage purple) plus a few evenly-spread spectrum stops so a
 * festival's stages can be told apart at a glance. A free hex entry remains
 * available via the TextInput for anything off-palette.
 */
export const STAGE_COLOR_PRESETS: readonly string[] = [
  '#00e8d0', // aqua (brand)
  '#ff3366', // coral
  '#ffb020', // amber
  '#39ff14', // green
  '#9c4dcb', // stage purple (accessible)
  '#4488ff', // blue
  '#f0a030', // warm orange
  '#22c55e', // verified green
  '#ff6b6b', // soft red
  '#1DB954', // spotify green
  '#eaeaf2', // light
  '#8787a8', // muted (fallback)
] as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export interface HexColorFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  hint?: string;
  error?: string | null;
  editable?: boolean;
}

export function HexColorField({ label, value, onChangeText, hint, error, editable = true }: HexColorFieldProps) {
  const t = useTokens();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  const isValid = HEX_RE.test(value.trim());
  const previewColor = isValid ? value.trim() : t.colors.stage.fallback;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.hexRow}>
        <View style={[styles.swatchPreview, { backgroundColor: previewColor }]} accessibilityLabel="Selected color preview" />
        <TextInput
          style={[styles.input, styles.hexInput, focused && styles.inputFocused]}
          value={value}
          onChangeText={onChangeText}
          placeholder="#00e8d0"
          placeholderTextColor={t.colors.text.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={7}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={`${label} hex value`}
        />
      </View>

      <View style={styles.swatchGrid}>
        {STAGE_COLOR_PRESETS.map((hex) => {
          const isActive = hex.toLowerCase() === value.trim().toLowerCase();
          return (
            <TouchableOpacity
              key={hex}
              style={[styles.swatch, { backgroundColor: hex }, isActive && styles.swatchActive]}
              onPress={() => editable && onChangeText(hex)}
              disabled={!editable}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Use color ${hex}`}
              accessibilityState={{ selected: isActive }}
            >
              {isActive ? <Ionicons name="checkmark" size={t.iconSize.sm} color={t.colors.text.onDark} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DateField / TimeField — validated text inputs (YYYY-MM-DD, HH:MM). NO native
// datetimepicker module. Empty/"TBA" is a permitted fallback (returns '').
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when the value is a structurally-valid YYYY-MM-DD calendar date. */
export function isValidDate(value: string): boolean {
  const v = value.trim();
  if (!DATE_RE.test(v)) return false;
  const parts = v.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** True when the value is a valid 24h HH:MM time. */
export function isValidTime(value: string): boolean {
  return TIME_RE.test(value.trim());
}

/** Empty or a literal "TBA" (case-insensitive) is the permitted fallback. */
function isTbaFallback(value: string): boolean {
  const v = value.trim();
  return v === '' || v.toLowerCase() === 'tba';
}

export interface DateTimeFieldProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  hint?: string;
  editable?: boolean;
}

export function DateField({ label, value, onChangeText, hint, editable = true }: DateTimeFieldProps) {
  const t = useTokens();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  const showError = !isTbaFallback(value) && !isValidDate(value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, showError && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={t.colors.text.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={`${label}, format year month day`}
      />
      {showError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          Use YYYY-MM-DD, or leave blank / “TBA”.
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function TimeField({ label, value, onChangeText, hint, editable = true }: DateTimeFieldProps) {
  const t = useTokens();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  const showError = !isTbaFallback(value) && !isValidTime(value);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, focused && styles.inputFocused, showError && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholder="HH:MM"
        placeholderTextColor={t.colors.text.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        editable={editable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={`${label}, format hours minutes 24 hour`}
      />
      {showError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          Use HH:MM (24h), or leave blank / “TBA”.
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  field: {
    gap: t.spacing[2],
  },
  label: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  inputError: {
    borderColor: t.colors.accent.coral,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  // ModalSelect ------------------------------------------------------------
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  selectValue: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  selectPlaceholder: {
    ...typeStyle('body'),
    color: t.colors.text.placeholder,
    flex: 1,
  },
  scrim: {
    flex: 1,
    backgroundColor: t.colors.shade[10],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: t.spacing[5],
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    padding: t.spacing[4],
    gap: t.spacing[2],
  },
  sheetTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    paddingHorizontal: t.spacing[2],
    paddingBottom: t.spacing[2],
  },
  sheetList: {
    flexGrow: 0,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
    borderRadius: t.radii.default,
  },
  optionLabel: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  optionLabelActive: {
    color: t.colors.accent.aqua,
  },
  // HexColorField ----------------------------------------------------------
  hexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  swatchPreview: {
    width: 40,
    height: 40,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  hexInput: {
    flex: 1,
  },
  swatchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: t.radii.sm,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: {
    borderWidth: 2,
    borderColor: t.colors.text.primary,
  },
}));
