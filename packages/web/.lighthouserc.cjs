module.exports = {
  ci: {
    collect: {
      url: [
        'https://festie.us/',
        'https://festie.us/cards',
        'https://festie.us/festival-mode',
      ],
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:pwa': ['warn', { minScore: 0.8 }],
        'total-byte-weight': ['warn', { maxNumericValue: 800000 }],
      },
    },
    upload: { target: 'temporary-public-storage' },
  },
};
