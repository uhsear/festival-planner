import { Modal, View, Text, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { makeStyles, typeStyle } from '../../hooks/useTokens';

/**
 * Reusable destructive-confirm dialog for the admin surface.
 *
 * Built on core React Native <Modal> (NO native dep) so it stays OTA-able. Used
 * to gate EVERY admin mutation — delete, grant, reset, bulk op — before the
 * shared api.* call fires. When `destructive`, the confirm button uses the
 * coral danger token (filled coralStrong for AA-passing white label text per
 * the accent rule in shared/tokens/colors.ts); otherwise it uses the aqua
 * primary accent with dark ink.
 *
 * Pattern: the parent owns the visible/onConfirm/onCancel state, mirroring the
 * inline-edit sections (AccountDisplayNameSection et al.) — this component is
 * purely presentational.
 */
export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** When true, the confirm button is styled as a danger action (coral). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const styles = useStyles();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        {/* A sibling backdrop avoids Pressable grouping the entire dialog into
            one screen-reader target. The visible Cancel action stays explicit. */}
        <Pressable style={styles.backdrop} onPress={onCancel} accessible={false} />
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView
            contentContainerStyle={styles.cardContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.message}>{message}</Text>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={onCancel}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, destructive ? styles.confirmDanger : styles.confirmPrimary]}
                onPress={onConfirm}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
              >
                <Text style={destructive ? styles.confirmDangerLabel : styles.confirmPrimaryLabel}>
                  {confirmLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  scrim: {
    flex: 1,
    backgroundColor: t.colors.shade[10],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: t.spacing[5],
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    padding: t.spacing[5],
    maxHeight: '85%',
  },
  cardContent: {
    gap: t.spacing[3],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  message: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  actions: {
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  button: {
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
  },
  cancelButton: {
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  confirmPrimary: {
    backgroundColor: t.colors.accent.aqua,
  },
  confirmPrimaryLabel: {
    ...typeStyle('label', 600),
    // Dark ink on filled aqua — the AA-passing pair per the accent rule.
    color: t.colors.text.onLightAccent,
  },
  confirmDanger: {
    // Deepened coral fill — ~6.04:1 against white, passes AA for the label.
    backgroundColor: t.colors.accent.coralStrong,
  },
  confirmDangerLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.onAccent,
  },
}));
