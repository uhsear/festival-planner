import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@festie/shared/stores';
import { colors, spacing, fontSize, radii } from '@festie/shared/tokens';

export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={styles.container}>
      <Ionicons name="person-circle" size={64} color={colors.accent.aqua} />
      <Text style={styles.username}>{user?.username ?? 'Account'}</Text>
      <Text style={styles.email}>{user?.email ?? ''}</Text>
      <Text style={styles.subtitle}>Coming soon</Text>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={logout}
        activeOpacity={0.8}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.text.danger} />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  username: {
    fontSize: fontSize[24],
    fontWeight: '700',
    color: colors.text.primary,
    marginTop: spacing[2],
  },
  email: {
    fontSize: fontSize[14],
    color: colors.text.secondary,
  },
  subtitle: {
    fontSize: fontSize[16],
    color: colors.text.muted,
    marginTop: spacing[2],
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[8],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: radii.default,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  logoutText: {
    fontSize: fontSize[16],
    fontWeight: '600',
    color: colors.text.danger,
  },
});
