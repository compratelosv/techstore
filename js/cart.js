/* cart.js — carrito en localStorage.
 * Solo se guarda product_id, qty y una copia para mostrar (nombre, precio, imagen).
 * Los importes que se cobran los recalcula el servidor al crear el pedido.
 */
const KEY = 'ts.cart.v1';

export function getCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  localStorage.setItem('ts.cart.count', String(items.reduce((n, i) => n + i.qty, 0)));
  document.dispatchEvent(new CustomEvent('cart:change'));
  return items;
}

export function addItem(product, qty = 1) {
  const items = getCart();
  const found = items.find((i) => i.id === product.id);
  const nextQty = (found?.qty || 0) + qty;
  if (product.stock !== undefined && nextQty > product.stock) {
    throw new Error(`Solo hay ${product.stock} disponibles de ${product.name}`);
  }
  if (found) {
    found.qty = nextQty;
    found.price = product.price;
  } else {
    items.push({
      id: product.id,
      sku: product.sku,
      name: product.name,
      price: Number(product.price),
      image_url: product.image_url,
      stock: product.stock,
      qty,
    });
  }
  return save(items);
}

export function setQty(id, qty) {
  const items = getCart();
  const item = items.find((i) => i.id === id);
  if (!item) return items;
  if (qty <= 0) return save(items.filter((i) => i.id !== id));
  if (item.stock !== undefined && qty > item.stock) {
    throw new Error(`Solo hay ${item.stock} disponibles`);
  }
  item.qty = qty;
  return save(items);
}

export function removeItem(id) {
  return save(getCart().filter((i) => i.id !== id));
}

export function clearCart() {
  return save([]);
}

export function cartTotal() {
  return getCart().reduce((n, i) => n + i.price * i.qty, 0);
}

export function cartCount() {
  return getCart().reduce((n, i) => n + i.qty, 0);
}

/** Convierte el carrito al payload que espera la función ts_place_order. */
export function toOrderItems() {
  return getCart().map((i) => ({ product_id: i.id, qty: i.qty }));
}
