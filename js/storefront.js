/* storefront.js — home + catálogo */
import { sb, money, esc, toast, mountHeader, errMessage } from './core.js?v=5214a642';
import { addItem, cartCount } from './cart.js?v=213c08d9';

let products = [];
let categories = [];
let activeCat = 'all';
let query = '';

const grid = document.getElementById('grid');
const empty = document.getElementById('emptyState');
const countEl = document.getElementById('catalogCount');
const filtersEl = document.getElementById('filters');

function stockTag(p) {
  if (p.stock === 0) return '<span class="stock-tag out">Agotado</span>';
  if (p.stock <= p.low_stock) return `<span class="stock-tag low">Quedan ${p.stock}</span>`;
  return '<span class="stock-tag">Disponible</span>';
}

function card(p) {
  return `
    <article class="card">
      <a class="card-img" href="producto.html?sku=${encodeURIComponent(p.sku)}">
        <img src="${esc(p.image_url || 'assets/img/placeholder.svg')}" alt="${esc(p.name)}" loading="lazy">
      </a>
      <div class="card-body">
        <span class="card-brand">${esc(p.brand || '')}</span>
        <a class="card-name" href="producto.html?sku=${encodeURIComponent(p.sku)}">${esc(p.name)}</a>
        <div class="card-foot">
          <div>
            <div class="price">${money(p.price)}</div>
            ${stockTag(p)}
          </div>
          <button class="btn primary" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
            ${p.stock === 0 ? 'Agotado' : 'Agregar'}
          </button>
        </div>
      </div>
    </article>`;
}

function visible() {
  const q = query.trim().toLowerCase();
  return products.filter((p) => {
    const okCat = activeCat === 'all' || p.category_id === activeCat;
    const okQ = !q ||
      p.name.toLowerCase().includes(q) ||
      (p.brand || '').toLowerCase().includes(q) ||
      (p.sku || '').toLowerCase().includes(q);
    return okCat && okQ;
  });
}

function render() {
  const items = visible();
  grid.innerHTML = items.map(card).join('');
  empty.hidden = items.length > 0;
  countEl.textContent = `${items.length} producto${items.length === 1 ? '' : 's'}`;
}

async function load() {
  const [cats, prods] = await Promise.all([
    sb.from('ts_categories').select('*').order('sort_order'),
    sb.from('ts_products').select('*').eq('active', true).order('name'),
  ]);
  if (prods.error) {
    countEl.textContent = 'No se pudo cargar el catálogo';
    toast(errMessage(prods.error), 'err');
    return;
  }
  categories = cats.data || [];
  products = prods.data || [];

  filtersEl.innerHTML =
    `<button class="chip active" data-cat="all">Todos</button>` +
    categories.map((c) => `<button class="chip" data-cat="${c.id}">${esc(c.name)}</button>`).join('');

  render();
}

/* ---------- eventos ---------- */
filtersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  activeCat = btn.dataset.cat;
  filtersEl.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
  render();
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  query = e.target.value;
  render();
});

grid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const product = products.find((p) => p.id === btn.dataset.add);
  if (!product) return;
  try {
    addItem(product, 1);
    toast(`${product.name} agregado al carrito`);
    const link = document.querySelector('.cart-link b');
    if (link) link.textContent = cartCount() || '';
  } catch (err) {
    toast(err.message, 'err');
  }
});

mountHeader({ active: 'home' });
load();
