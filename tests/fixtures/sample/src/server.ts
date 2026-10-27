import { saveOrder } from './orders';
import type { CartItem } from './checkout';

interface OrderRequest {
  items: CartItem[];
}

// Validate at the boundary, even when the caller is trusted.
export async function createOrder(request: OrderRequest) {
  for (const item of request.items) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error('Quantity must be a positive integer.');
    }
  }

  const order = await saveOrder(request.items);
  return { id: order.id, status: 'confirmed' as const };
}
