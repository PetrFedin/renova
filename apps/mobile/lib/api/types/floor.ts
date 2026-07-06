/** План этажа, мебель, вывоз */
export type FloorPlan = {
  id: string;
  name: string;
  image_key: string;
  image_url: string;
  width_px?: number | null;
  height_px?: number | null;
  pins: { id: string; room_id: string; x_pct: number; y_pct: number; label?: string | null }[];
};

export type WasteOrder = {
  id: string;
  room_id?: string | null;
  volume_m3: number;
  waste_type: string;
  scheduled_date?: string | null;
  status: string;
  price: number;
  notes?: string | null;
  total: number;
};

export type FurnitureItem = {
  id: string;
  room_id?: string | null;
  name: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  x_pct?: number | null;
  y_pct?: number | null;
};
