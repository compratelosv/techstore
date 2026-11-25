/* product.js — ficha de producto */
import { sb, money, esc, toast, mountHeader, errMessage } from './core.js?v=454f869e';
import { addItem, cartCount } from './cart.js?v=213c08d9';

const view = document.getElementById('productView');
const sku = new URLSearchParams(location.search).get('sku');

function specRow(k, v) {
  return v ? `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>` : '';
}

async function load() {
  if (!sku) {
    view.innerHTML = '<div class="empty">Falta el producto.</div>';
    return;
  }
  const { data: p, error } = await sb
    .from('ts_products')
    .select('*, ts_categories(name)')
    .eq('sku', sku)
    .maybeSingle();

  if (error || !p) {
    view.innerHTML = '<div class="empty">Ese producto no existe o ya no está disponible.</div>';
    if (error) toast(errMessage(error), 'err');
    return;
  }

  document.title = `${p.name} · TechStore SV`;
  document.getElementById('crumb').textContent = p.name;

  const low = p.stock > 0 && p.stock <= p.low_stock;
  const out = p.stock === 0;
  const photos = Array.isArray(p.images) && p.images.length
    ? p.images.filter(Boolean)
    : (p.image_url ? [p.image_url] : ['assets/img/placeholder.svg']);

  view.innerHTML = `
    <div class="product-layout">
      <div class="product-media">
        <img id="pmMain" src="${esc(photos[0])}" alt="${esc(p.name)}">
        ${photos.length > 1 ? `<div class="pm-thumbs">
          ${photos.map((u, i) => `<button type="button" class="pm-thumb ${i === 0 ? 'active' : ''}" data-img="${esc(u)}" aria-label="Foto ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}
        </div>` : ''}
      </div>
      <div class="product-info">
        <span class="eyebrow">${esc(p.ts_categories?.name || 'Tecnología')}</span>
        <h1>${esc(p.name)}</h1>
        <p class="muted">${esc(p.brand || '')} · SKU ${esc(p.sku)}</p>
        <div class="product-price">${money(p.price)}</div>
        <p class="${out ? 'stock-tag out' : low ? 'stock-tag low' : 'stock-tag'}">
          ${out ? 'Agotado' : low ? `Quedan ${p.stock} unidades` : `Disponible (${p.stock} en stock)`}
        </p>
        <p class="muted" style="margin:1.1rem 0">${esc(p.description || '')}</p>

        <div class="qty">
          <button type="button" id="qMinus" aria-label="Menos">−</button>
          <input id="qty" type="number" min="1" max="${p.stock || 1}" value="1" inputmode="numeric">
          <button type="button" id="qPlus" aria-label="Más">+</button>
        </div>

        <div class="actions">
          <button class="btn primary block" id="addBtn" ${out ? 'disabled' : ''}>
            ${out ? 'Sin existencias' : 'Agregar al carrito'}
          </button>
          <a class="btn ghost block" href="carrito.html">Ver carrito</a>
        </div>

        <div class="spec">
          ${specRow('Marca', p.brand)}
          ${specRow('Categoría', p.ts_categories?.name)}
          ${specRow('SKU', p.sku)}
          ${specRow('Garantía', '6 meses')}
          ${specRow('Entrega', 'Envío por zona o retiro en tienda')}
        </div>
      </div>
    </div>`;

  const qtyEl = document.getElementById('qty');
  const clamp = () => {
    const v = Math.max(1, Math.min(Number(qtyEl.value) || 1, p.stock || 1));
    qtyEl.value = v;
    return v;
  };
  document.getElementById('qMinus').onclick = () => { qtyEl.value = Math.max(1, Number(qtyEl.value) - 1); };
  document.getElementById('qPlus').onclick = () => { qtyEl.value = Math.min(p.stock || 1, Number(qtyEl.value) + 1); };
  qtyEl.onchange = clamp;

  view.querySelectorAll('.pm-thumb').forEach((b) => {
    b.onclick = () => {
      document.getElementById('pmMain').src = b.dataset.img;
      view.querySelectorAll('.pm-thumb').forEach((x) => x.classList.toggle('active', x === b));
    };
  });

  document.getElementById('addBtn').onclick = () => {
    try {
      addItem(p, clamp());
      toast(`${p.name} agregado al carrito`);
      const badge = document.querySelector('.cart-link b');
      if (badge) badge.textContent = cartCount() || '';
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

mountHeader({ active: 'catalog' });
load();
