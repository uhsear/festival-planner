// Custom entry: configure platform storage (AsyncStorage) BEFORE expo-router
// loads any route/store module. zustand-persist hydrates a store the moment its
// module is first evaluated, reading whatever getStorage() returns then — so the
// adapter must be set before expo-router/entry pulls in @festie/shared stores.
// Relying on import order inside app/_layout.tsx is not enough: expo-router may
// evaluate other route modules (which import the stores) first.
import './bootstrap';
import 'expo-router/entry';
