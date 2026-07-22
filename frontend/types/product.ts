export interface ProductVariant {
  id: string;
  color?: string;
  size?: string;
  stock: number;
  available: boolean;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  currency: string;
  inStock: boolean;
  image: string;
  images: string[];
  variants: ProductVariant[];
  sizes: string[];
  colors: string[];
}
