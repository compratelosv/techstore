/* cart-page.js — carrito con stock en vivo */
import { sb, money, esc, toast, mountHeader, setCartCount, errMessage } from './core.js?v=454f869e';
import { getCart, setQty, removeItem, clearCart, cartTotal, cartCount } from './cart.js?v=213c08d9';

const linesEl = document.getElementById('cartLines');
const emptyEl = document.getElementById('cartEmpty');
const summaryEl = document.getElementById('summary');
const rowsEl = document.getElementById('summaryRows');

let items = getCart();

async function refreshStock() {
  if (!items.length) return;
  const ids = items.map((i) => i.id);
  const { data, error } = await sb.from('ts_products').select('id, stock, price, active').in('id', ids);
  if (error) return;
  const map = new Map(data.map((p) => [p.id, p]));
  items = items
    .map((i) => {
      const live = map.get(i.id);
      if (!live || !live.active) return { ...i, stock: 0, removed: true };
      return { ...i, stock: live.stock, price: Number(live.price) };
    })
    .filter((i) => !i.removed);
}

function render() {
  const active = items.filter((i) => i.qty > 0 && i.stock > 0);
  linesEl.innerHTML = items
    .map((i) => {
      const soldOut = i.stock === 0;
      return `
      <div class="line">
        <img src="${esc(i.image_url || 'assets/img/placeholder.svg')}" alt="">
        <div>
          <div class="line-name">${esc(i.name)}</div>
          <div class="line-meta">${esc(i.sku)} · ${money(i.price)} c/u ${soldOut ? '· <b style="color:var(--bad)">Agotado</b>' : ''}</div>
        </div>
        <div class="line-actions">
          <div class="qty-sm">
            <button type="button" data-dec="${i.id}" ${soldOut ? 'disabled' : ''}>−</button>
            <span>${i.qty}</span>
            <button type="button" data-inc="${i.id}" ${soldOut ? 'disabled' : ''}>+</button>
          </div>
          <button class="icon-btn" data-del="${i.id}" title="Quitar">✕</button>
        </div>
      </div>`;
    })
    .join('');

  const subtotal = active.reduce((n, i) => n + i.price * i.qty, 0);
  rowsEl.innerHTML = `
    <div class="summary-row"><span>${cartCount()} artículo(s)</span><span>${money(subtotal)}</span></div>
    <div class="summary-row total"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <p class="small muted" style="margin:.6rem 0 1rem">El costo de envío se calcula en el siguiente paso según la zona.</p>`;

  const isEmpty = items.length === 0;
  emptyEl.hidden = !isEmpty;
  summaryEl.hidden = isEmpty;
  document.getElementById('goCheckout').style.pointerEvents = active.length ? 'auto' : 'none';
  document.getElementById('goCheckout').style.opacity = active.length ? '1' : '.5';
  setCartCount(cartCount());
}

linesEl.addEventListener('click', (e) => {
  const inc = e.target.closest('[data-inc]');
  const dec = e.target.closest('[data-dec]');
  const del = e.target.closest('[data-del]');
  if (inc) {
    const item = items.find((i) => i.id === inc.dataset.inc);
    try { setQty(item.id, item.qty + 1); } catch (err) { toast(err.message, 'err'); }
  } else if (dec) {
    const item = items.find((i) => i.id === dec.dataset.dec);
    setQty(item.id, item.qty - 1);
  } else if (del) {
    removeItem(del.dataset.del);
  } else return;
  items = getCart();
  render();
});

document.getElementById('clearBtn').onclick = () => {
  clearCart();
  items = [];
  render();
  toast('Carrito vacío');
};

document.addEventListener('cart:change', () => {
  items = getCart();
  render();
});

(async () => {
  mountHeader({ active: 'cart' });
  await refreshStock();
  render();
})().catch((err) => toast(errMessage(err), 'err'));
