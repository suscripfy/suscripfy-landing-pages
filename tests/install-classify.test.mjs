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

test('belleza / pelo → ok', () => {
  const r = classify([p('Shampoo con proteína de seda'), p('Sérum con aminoácidos'), p('Aceite de magnesio corporal')]);
  assert.equal(r.category, 'ok');
  assert.equal(r.matches, 0);
});

test('comida con proteína (sin señal de suplemento) → ok', () => {
  const r = classify([p('Mantequilla de maní alta en proteína 500 g'), p('Barra de proteína chocolate')]);
  assert.equal(r.category, 'ok');
  assert.equal(r.matches, 0);
});

test('vitaminas y adelgazantes → ok', () => {
  const r = classify([p('Vitamina C cápsulas'), p('Multivitamínico gomitas'), p('Té quemador')]);
  assert.equal(r.category, 'ok');
  assert.equal(r.matches, 0);
});

test('cosméticos con 1 suplemento → review', () => {
  const r = classify([p('Crema facial'), p('Colágeno hidrolizado en polvo')]);
  assert.equal(r.category, 'review');
  assert.deepEqual(r.evidence, ['Colágeno hidrolizado en polvo']);
});

test('catálogo de 3 con 1 coincidencia → review (sin regla del 20 %)', () => {
  const r = classify([p('Creatina monohidratada'), p('Camiseta 1', 'Ropa'), p('Gorra', 'Ropa')]);
  assert.equal(r.category, 'review');
  assert.equal(r.matches, 1);
});

test('suplementos que compiten → blocked', () => {
  assert.equal(classify([p('Whey Protein 2 lb'), p('Creatina monohidratada 300 g')]).category, 'blocked');
  assert.equal(classify([p('Proteína vegana en polvo'), p('Magnesio en cápsulas')]).category, 'blocked');
});

test('exclusión de cuidado personal → ok', () => {
  const r = classify([p('Crema de colágeno'), p('Mascarilla de colágeno en sachet')]);
  assert.equal(r.category, 'ok');
  assert.equal(r.matches, 0);
});

test('"amino" suelto no cuenta; gramos/kg/lb/sabor no son señal', () => {
  assert.equal(classify([p('Amino Energy'), p('Proteína 2 lb sabor vainilla'), p('Magnesio 1 kg')]).category, 'ok');
});

test('tildes, tags y product_type; la descripción no cuenta', () => {
  assert.equal(classify([p('Bolsa 3 kg', 'PROTEÍNA', ['polvo']), p('Sabor fresa', '', ['BCAA']), ...filler(20)]).category, 'blocked');
  const dogFood = { title: 'Alimento para perro adulto', product_type: 'Mascotas', tags: [], body_html: 'Whey en polvo y creatina' };
  assert.equal(classify([dogFood, ...filler(3)]).category, 'ok');
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
