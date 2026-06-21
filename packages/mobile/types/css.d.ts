// Ambient typing for CSS imported as a side-effect-only module on the web export.
// `packages/web` gets this from `vite/client`; mobile has no bundler CSS typing,
// so OfflineMap.web.tsx's `import('maplibre-gl/dist/maplibre-gl.css')` would
// otherwise be TS2307. metro handles the actual CSS on `expo export -p web`;
// native never resolves a `.web.tsx`, so this never reaches the native bundle.
declare module '*.css';
