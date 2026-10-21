import { describe, test, assert } from './runner.js';
import { compilePath, parseHash, defineRoutes, matchRoute, href } from '../js/core/router.js';

describe('router', () => {
  test('compilePath matches params and optional trailing slash', () => {
    const { regex, keys } = compilePath('/patients/:id/:tab');
    assert.deepEqual(keys, ['id', 'tab']);
    assert.ok(regex.test('/patients/42/chart'));
    assert.ok(regex.test('/patients/42/chart/'));
    assert.ok(!regex.test('/patients/42'));
    assert.ok(compilePath('/').regex.test('/'));
  });
  test('parseHash splits path and query', () => {
    assert.deepEqual(parseHash('#/patients?q=%D8%A3&page=2'), { path: '/patients', query: { q: 'أ', page: '2' } });
    assert.deepEqual(parseHash(''), { path: '/', query: {} });
    assert.deepEqual(parseHash('#patients/'), { path: '/patients', query: {} });
  });
  test('matchRoute returns the first match with decoded params', () => {
    defineRoutes([
      { path: '/', load: async () => ({}) },
      { path: '/patients/new', load: async () => ({}) },
      { path: '/patients/:id', load: async () => ({}) },
    ]);
    assert.equal(matchRoute('/patients/new').route.path, '/patients/new');
    assert.deepEqual(matchRoute('/patients/abc-1').params, { id: 'abc-1' });
    assert.equal(matchRoute('/nope'), null);
  });
  test('href builds encoded hashes', () => {
    assert.equal(href('/patients/:id', { id: 'a b' }), '#/patients/a%20b');
    assert.equal(href('/patients', {}, { q: 'x' }), '#/patients?q=x');
  });
});
