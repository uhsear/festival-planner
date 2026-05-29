// Expo Babel configuration.
//
// IMPORTANT: 'react-native-reanimated/plugin' MUST be the LAST entry in the
// plugins array. The Reanimated Babel plugin rewrites worklets and assumes it
// runs after every other transform; placing anything after it breaks gestures
// and shared-value animations at runtime.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
