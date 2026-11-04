// Ejecutar: node --test tests/install-classify.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, normalizeShopInput, isPrivateIp, signMessage,
} from '../api/install/_lib.js';

const p = (title, product_type = '', tags = []) => ({ title, product_type, tags });
const filler = (n, prefix = 'Camiseta') => Array.from({ length: n }, (_, i) => p(`${prefix} ${i + 1}`, 'Ropa'));

test('tienda de proteínas → blocked', () => {
  const r = classify([
    p('Proteína Whey Vainilla 900 g', 'Suplementos'),
    p('Whey Isolate Chocolate 2 lb'),
    p('Creatina Monohidratada 300 g'),
    p('Shaker 600 ml', 'Accesorios'),
    ...filler(10),
  ]);
  assert.equal(r.category, 'blocked');
  assert.equal(r.matches, 3);
  assert.ok(r.evidence.length <= 5);
  assert.ok(r.evidence.includes('Proteína Whey Vainilla 900 g'));
});

test('crema con colágeno (no suplemento) → ok', () => {
  const r = classify([
    p('Crema facial con colágeno y ácido hialurónico', 'Cuidado facial', ['skincare', 'colageno']),
    p('Sérum de colágeno marino', 'Cuidado facial'),
    p('Contorno de ojos', 'Cuidado facial'),
  ]);
  assert.equal(r.category, 'ok');
  assert.equal(r.matches, 0);
});

test('colágeno hidrolizado en polvo sí cuenta', () => {
  const r = classify([p('Colágeno Hidrolizado 500 g'), p('Collagen powder sabor fresa'), ...filler(20)]);
  assert.equal(r.category, 'blocked');
  assert.equal(r.matches, 2);
});

test('una sola creatina en catálogo grande → review (permitida)', () => {
  const r = classify([p('Creatine Monohydrate 300 g'), ...filler(9, 'Café de origen')]);
  assert.equal(r.category, 'review');
  assert.equal(r.matches, 1);
  assert.deepEqual(r.evidence, ['Creatine Monohydrate 300 g']);
});

test('vitaminas y adelgazantes → ok', () => {
  const r = classify([
    p('Vitamina C 1000 mg x 60 tabletas', 'Vitaminas'),
    p('Multivitamínico mujer', 'Vitaminas', ['vitaminas', 'salud']),
    p('Té adelgazante detox', 'Bienestar'),
    p('Omega 3 cápsulas', 'Vitaminas'),
    p('Vitamina D3 gotas', 'Vitaminas'),
  ]);
  assert.equal(r.category, 'ok');
});

test('regla del 20 %: 1 de 5 → blocked, 1 de 6 → review', () => {
  assert.equal(classify([p('Pre-entreno Explosive'), ...filler(4)]).category, 'blocked');
  assert.equal(classify([p('Pre-entreno Explosive'), ...filler(5)]).category, 'review');
});

test('tildes, tags y product_type; la descripción no cuenta', () => {
  assert.equal(classify([p('Bolsa 3 kg', 'PROTEÍNA'), p('Sabor fresa', '', ['BCAA']), ...filler(20)]).category, 'blocked');
  const dogFood = { title: 'Alimento para perro adulto', product_type: 'Mascotas', tags: [], body_html: 'Alto en proteína y magnesio' };
  assert.equal(classify([dogFood, ...filler(3)]).category, 'ok');
});

test('"termo aislado" no se confunde con aislado de proteína', () => {
  assert.equal(classify([p('Termo aislado 1 L'), p('Vaso aislado 500 ml'), ...filler(3)]).category, 'ok');
});

test('catálogo vacío → ok', () => {
  assert.equal(classify([]).category, 'ok');
  assert.equal(classify(null).category, 'ok');
});

test('normalizeShopInput', () => {
  assert.deepEqual(normalizeShopInput('https://admin.shopify.com/store/mi-tienda/products'), { host: 'mi-tienda.myshopify.com', kind: 'myshopify' });
  assert.deepEqual(normalizeShopInput('Mi-Tienda.myshopify.com'), { host: 'mi-tienda.myshopify.com', kind: 'myshopify' });
  assert.deepEqual(normalizeShopInput('https://www.mitienda.com.co/collections/all'), { host: 'www.mitienda.com.co', kind: 'custom' });
  assert.equal(normalizeShopInput('localhost'), null);
  assert.equal(normalizeShopInput('127.0.0.1'), null);
  assert.equal(normalizeShopInput('http://[::1]/'), null);
  assert.equal(normalizeShopInput('foo.internal'), null);
  assert.equal(normalizeShopInput('user@evil.com'), null);
  assert.equal(normalizeShopInput('evil.com:8080'), null);
  assert.equal(normalizeShopInput(''), null);
});

test('isPrivateIp', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '100.64.1.1', '172.16.5.4', '192.168.1.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['23.227.38.65', '8.8.8.8', '2606:4700::6810:84e5', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('firma HMAC: `${ts}.${METHOD}.${path}.${payload}`', () => {
  const sig = signMessage('secreto', '1700000000', 'get', '/public/install/status', 'token=abc');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(sig, signMessage('secreto', '1700000000', 'GET', '/public/install/status', 'token=abc'));
});
