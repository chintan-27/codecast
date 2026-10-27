import type { CartItem } from './checkout';

interface Order {
  id: string;
  items: CartItem[];
  createdAt: string;
}

// An in-memory store keeps this teaching fixture self-contained.
const orders = new Map<string, Order>();

export async function saveOrder(items: CartItem[]): Promise<Order> {
  const order = {
    id: crypto.randomUUID(),
    items: items.map((item) => ({ ...item })),
    createdAt: new Date().toISOString(),
  };

  orders.set(order.id, order);
  return order;
}
