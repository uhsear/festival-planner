// Harness smoke test: proves the vitest bring-up runs green. Real mobile-local
// tests live alongside their targets; this only verifies that the test runner
// loads and executes without error.
describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
