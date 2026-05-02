const { afterEach, describe, test } = require('node:test');
const {
  assert,
  Pool,
  TEST_DATABASE_URL,
  startServer,
  registerUser,
  joinFestivalProfile,
} = require('./_integration-helpers');

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await server.close();
  }
});

describe('Integration — Ratings', { concurrency: 1 }, () => {
  test('creates a rating for a set, retrieves it by festival, then deletes it', async () => {
    const server = await startServer();
    servers.push(server);

    const alice = await registerUser(server, 'ratings-alice-' + Date.now());
    await joinFestivalProfile(server, alice.token);

    // Create rating for set-a (exists in seed data as part of fest-1)
    const createRes = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', alice.token)
      .send({ rating: 5, note: 'Amazing show!' })
      .expect(200);

    assert.equal(createRes.body.ok, true);
    assert.equal(createRes.body.data.rating, 5);
    assert.equal(createRes.body.data.note, 'Amazing show!');
    assert.equal(createRes.body.data.setId, 'set-a');

    // Retrieve ratings for the festival
    const listRes = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(listRes.body.ok, true);
    assert.ok(Array.isArray(listRes.body.data.ratings));
    assert.equal(listRes.body.data.ratings.length, 1);
    assert.equal(listRes.body.data.ratings[0].setId, 'set-a');
    assert.equal(listRes.body.data.ratings[0].rating, 5);

    // Delete the rating
    const deleteRes = await server.request
      .delete('/api/v1/ratings/set-a')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(deleteRes.body.ok, true);
    assert.equal(deleteRes.body.data.deleted, true);

    // Verify deletion
    const afterDelete = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', alice.token)
      .expect(200);

    assert.equal(afterDelete.body.data.ratings.length, 0);
  });

  test('upserts a rating when the same set is rated again', async () => {
    const server = await startServer();
    servers.push(server);

    const bob = await registerUser(server, 'ratings-bob-' + Date.now());
    await joinFestivalProfile(server, bob.token);

    // Create initial rating
    await server.request
      .post('/api/v1/ratings/set-b')
      .set('x-user-token', bob.token)
      .send({ rating: 3 })
      .expect(200);

    // Update rating for the same set
    const upsertRes = await server.request
      .post('/api/v1/ratings/set-b')
      .set('x-user-token', bob.token)
      .send({ rating: 5, note: 'Changed my mind, was great!' })
      .expect(200);

    assert.equal(upsertRes.body.data.rating, 5);
    assert.equal(upsertRes.body.data.note, 'Changed my mind, was great!');

    // Verify only one rating exists for that set
    const listRes = await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .set('x-user-token', bob.token)
      .expect(200);

    assert.equal(listRes.body.data.ratings.length, 1);
    assert.equal(listRes.body.data.ratings[0].rating, 5);
  });

  test('requires authentication for rating endpoints', async () => {
    const server = await startServer();
    servers.push(server);

    // POST without auth
    await server.request
      .post('/api/v1/ratings/set-a')
      .send({ rating: 4 })
      .expect(401);

    // GET user ratings without auth
    await server.request
      .get('/api/v1/ratings/festival/fest-1')
      .expect(401);

    // DELETE without auth
    await server.request
      .delete('/api/v1/ratings/set-a')
      .expect(401);
  });

  test('rejects invalid rating values', async () => {
    const server = await startServer();
    servers.push(server);

    const charlie = await registerUser(server, 'ratings-charlie-' + Date.now());
    await joinFestivalProfile(server, charlie.token);

    // Rating too low (0)
    const tooLow = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 0 });
    assert.ok(tooLow.status >= 400, 'Rating of 0 should be rejected');

    // Rating too high (6)
    const tooHigh = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 6 });
    assert.ok(tooHigh.status >= 400, 'Rating of 6 should be rejected');

    // Non-integer rating
    const nonInt = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ rating: 3.5 });
    assert.ok(nonInt.status >= 400, 'Non-integer rating should be rejected');

    // Missing rating field
    const missing = await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', charlie.token)
      .send({ note: 'no rating' });
    assert.ok(missing.status >= 400, 'Missing rating should be rejected');
  });

  test('returns 404 when rating a nonexistent set', async () => {
    const server = await startServer();
    servers.push(server);

    const dave = await registerUser(server, 'ratings-dave-' + Date.now());
    await joinFestivalProfile(server, dave.token);

    const res = await server.request
      .post('/api/v1/ratings/nonexistent-set-' + Date.now())
      .set('x-user-token', dave.token)
      .send({ rating: 4 });

    assert.equal(res.status, 404);
  });

  test('aggregate ratings endpoint returns data for all users', async () => {
    const server = await startServer();
    servers.push(server);

    const user1 = await registerUser(server, 'ratings-agg1-' + Date.now());
    const user2 = await registerUser(server, 'ratings-agg2-' + Date.now());
    await joinFestivalProfile(server, user1.token);
    await joinFestivalProfile(server, user2.token);

    // Both users rate set-c
    await server.request
      .post('/api/v1/ratings/set-c')
      .set('x-user-token', user1.token)
      .send({ rating: 4 })
      .expect(200);

    await server.request
      .post('/api/v1/ratings/set-c')
      .set('x-user-token', user2.token)
      .send({ rating: 2 })
      .expect(200);

    // Aggregate endpoint is public (no auth required)
    const aggRes = await server.request
      .get('/api/v1/ratings/festival/fest-1/all')
      .expect(200);

    assert.equal(aggRes.body.ok, true);
    const setCRating = aggRes.body.data.ratings.find(r => r.setId === 'set-c');
    assert.ok(setCRating, 'set-c should appear in aggregate ratings');
    assert.equal(setCRating.totalRatings, 2);
    assert.equal(setCRating.avgRating, 3); // (4+2)/2
  });

  test('wrap stats returns summary for user ratings', async () => {
    const server = await startServer();
    servers.push(server);

    const eve = await registerUser(server, 'ratings-eve-' + Date.now());
    await joinFestivalProfile(server, eve.token);

    // Rate multiple sets
    await server.request
      .post('/api/v1/ratings/set-a')
      .set('x-user-token', eve.token)
      .send({ rating: 5 })
      .expect(200);

    await server.request
      .post('/api/v1/ratings/set-d')
      .set('x-user-token', eve.token)
      .send({ rating: 4 })
      .expect(200);

    const wrapRes = await server.request
      .get('/api/v1/ratings/wrap/fest-1')
      .set('x-user-token', eve.token)
      .expect(200);

    assert.equal(wrapRes.body.ok, true);
    assert.ok(wrapRes.body.data.stats);
    assert.equal(wrapRes.body.data.stats.totalRated, 2);
    assert.ok(wrapRes.body.data.stats.avgRating > 0);
    assert.ok(Array.isArray(wrapRes.body.data.topSets));
    assert.ok(Array.isArray(wrapRes.body.data.allRatings));
  });
});
