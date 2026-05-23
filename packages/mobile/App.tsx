import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@festie/shared/tokens';

export default function App() {
  return (
    <View style={[styles.container, { backgroundColor: colors.bg.primary }]}>
      <Text style={styles.title}>Festie</Text>
      <Text style={styles.subtitle}>Festival Crew Coordination</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
});
