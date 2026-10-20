export interface DailyMenu {
  date: string;
  breakfast: string[];
  lunch: string[];
  dinner: string[];
}

export interface CoopDailyMenu {
  date: string;
  snackCorner: { western: string[]; ramen: string[]; snack: string[]; setMeal: string[] };
  staffRestaurant: { breakfast: string[]; lunch: string[]; dinner: string[] };
}

export interface MenuSection { key: string; label: string; items: string[] }
