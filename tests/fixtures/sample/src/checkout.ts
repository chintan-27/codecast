import { createOrder } from './server';

export interface CartItem {
  productId: string;
  quantity: number;
}

// The UI hands the cart to one application boundary.
export async function checkout(items: CartItem[]) {
  if (items.length === 0) {
    throw new Error('Your cart is empty.');
  }

  const response = await createOrder({ items });

  return {
    orderId: response.id,
    message: `Order ${response.id} is confirmed.`,
  };
}
