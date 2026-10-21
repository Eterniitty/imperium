/**
 * Reglas del mercado global: libro de órdenes por recurso con prioridad de
 * precio y luego de llegada. Funciones puras; el servidor aplica el resultado
 * en una transacción (créditos, envíos y libro de recursos).
 */
import { MARKET } from "@imperium/content";
import { roundCredits } from "./humanity";

export type OrderSide = "buy" | "sell";

/** Orden en el libro (lo mínimo para casarla). */
export interface BookOrder {
  id: string;
  /** Dueño: nunca se casa una orden con otra del mismo dueño. */
  ownerId: string;
  side: OrderSide;
  /** Precio por unidad, en créditos. */
  price: number;
  /** Unidades que quedan por casar. */
  remaining: number;
  /** Orden de llegada (milisegundos o secuencia): a igual precio, gana la más antigua. */
  createdAt: number;
}

/** Una casación: `quantity` unidades al precio de la orden que ya estaba en el libro. */
export interface Fill {
  makerId: string;
  quantity: number;
  price: number;
}

/** ¿Se cruzan una orden entrante y una del libro? */
export function crosses(side: OrderSide, price: number, maker: Pick<BookOrder, "side" | "price">): boolean {
  if (maker.side === side) return false;
  return side === "buy" ? maker.price <= price + 1e-9 : maker.price + 1e-9 >= price;
}

/** Ordena el lado contrario del libro: mejor precio primero y, a igual precio, la más antigua. */
export function sortBook(side: OrderSide, book: readonly BookOrder[]): BookOrder[] {
  // Quien compra busca las ventas más baratas; quien vende, las compras más caras.
  const dir = side === "buy" ? 1 : -1;
  return [...book].sort((a, b) => dir * (a.price - b.price) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Casa una orden entrante con el libro. El precio de cada casación es el de la
 * orden que ya estaba (quien llega primero fija el precio). No modifica la entrada.
 */
export function matchOrder(taker: { ownerId: string; side: OrderSide; price: number; quantity: number }, book: readonly BookOrder[]): { fills: Fill[]; remaining: number } {
  let left = taker.quantity;
  const fills: Fill[] = [];
  for (const maker of sortBook(taker.side, book)) {
    if (left <= 0) break;
    if (maker.ownerId === taker.ownerId || maker.remaining <= 0) continue;
    if (!crosses(taker.side, taker.price, maker)) break;
    const quantity = Math.min(left, maker.remaining);
    fills.push({ makerId: maker.id, quantity, price: maker.price });
    left -= quantity;
  }
  return { fills, remaining: left };
}

/** Créditos que paga quien compra `quantity` unidades a `price`. */
export function tradeValue(price: number, quantity: number): number {
  return roundCredits(price * quantity);
}

/** Comisión del mercado sobre una venta (va al tesoro de la humanidad). */
export function marketFee(value: number): number {
  return roundCredits(value * MARKET.feeRate);
}

/** ¿Es válido este precio? (dentro de los límites y con dos decimales como mucho). */
export function validPrice(price: number): boolean {
  return Number.isFinite(price) && price >= MARKET.minPrice && price <= MARKET.maxPrice && Math.abs(price * 100 - Math.round(price * 100)) < 1e-6;
}

/** ¿Es válida esta cantidad? (entera, positiva y acotada). */
export function validQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= MARKET.maxQuantity;
}

/** Niveles de precio de un lado del libro (cantidades sumadas por precio), del mejor al peor. */
export function bookDepth(side: OrderSide, orders: ReadonlyArray<{ price: number; remaining: number }>, levels: number = MARKET.depthLevels): Array<{ price: number; quantity: number }> {
  const byPrice = new Map<number, number>();
  for (const o of orders) byPrice.set(o.price, (byPrice.get(o.price) ?? 0) + o.remaining);
  const dir = side === "buy" ? -1 : 1;
  return [...byPrice.entries()]
    .sort((a, b) => dir * (a[0] - b[0]))
    .slice(0, levels)
    .map(([price, quantity]) => ({ price, quantity }));
}
