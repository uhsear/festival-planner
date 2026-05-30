// Bootstrap side effects that MUST run before any @festie/shared store is
// created. Zustand-persist hydrates a store at creation time (i.e. when its
// module is first imported), reading from whatever getStorage() returns then.
// If AsyncStorage isn't configured yet, hydration reads the noop adapter and
// the persisted auth token is lost on every cold start (user gets logged out).
//
// This module is imported FIRST in app/_layout.tsx so configureStorage runs
// before the stores barrel is evaluated.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureStorage } from '@festie/shared/platform';

configureStorage(AsyncStorage);
