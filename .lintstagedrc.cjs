module.exports = {
  '*.{ts,tsx,js,cjs}': () => 'eslint --fix lib/ routes/ server.ts',
};
