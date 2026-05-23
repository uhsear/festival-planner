import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize } from '@festie/shared/tokens';

export default function CrewScreen() {
  return (
    <View style={styles.container}>
      <Ionicons name="people" size={48} color={colors.accent.coral} />
      <Text style={styles.title}>Crew</Text>
      <Text style={styles.subtitle}>Coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
  },
  title: {
    fontSize: fontSize[24],
    fontWeight: '700',
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: fontSize[16],
    color: colors.text.secondary,
  },
});
