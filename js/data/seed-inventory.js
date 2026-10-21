/**
 * Starter data for phase 7: expense categories, a few common dental materials (quantity 0 —
 * the clinic records its real stock with "استلام بضاعة"), and the example recipe from the
 * brief for composite fillings. Everything is editable.
 */

export const SEED_EXPENSE_CATEGORIES = [
  { id: 'rent', name: 'إيجار' },
  { id: 'salaries', name: 'رواتب' },
  { id: 'utilities', name: 'كهرباء ومياه وإنترنت' },
  { id: 'lab', name: 'مصاريف المعمل' },
  { id: 'materials', name: 'شراء خامات ومستلزمات' },
  { id: 'maintenance', name: 'صيانة' },
  { id: 'marketing', name: 'تسويق وإعلانات' },
  { id: 'other', name: 'أخرى' },
];

/** key is only used to wire the seed recipe below. */
export const SEED_ITEMS = [
  { key: 'composite', name: 'كمبوزيت', category: 'حشوات', unit: 'g', minQty: 10 },
  { key: 'bond', name: 'بوند', category: 'حشوات', unit: 'drop', minQty: 50 },
  { key: 'etch', name: 'إتش (حمض)', category: 'حشوات', unit: 'dose', minQty: 30 },
  { key: 'anesthesia', name: 'بنج كاربول', category: 'تخدير', unit: 'carpule', minQty: 50 },
  { key: 'needle', name: 'إبر بنج', category: 'تخدير', unit: 'piece', minQty: 50 },
  { key: 'gloves', name: 'جوانتي (زوج)', category: 'مستلزمات', unit: 'pair', minQty: 100 },
  { key: 'mask', name: 'ماسك', category: 'مستلزمات', unit: 'piece', minQty: 50 },
  { key: 'cotton', name: 'قطن رول', category: 'مستلزمات', unit: 'piece', minQty: 100 },
  { key: 'files', name: 'فايلات عصب', category: 'علاج الجذور', unit: 'piece', minQty: 20 },
  { key: 'gp', name: 'جوتابركا', category: 'علاج الجذور', unit: 'piece', minQty: 50 },
  { key: 'naocl', name: 'هيبوكلوريت الصوديوم', category: 'علاج الجذور', unit: 'ml', minQty: 200 },
  { key: 'impression', name: 'مادة طبعة', category: 'تركيبات', unit: 'g', minQty: 200 },
  { key: 'tempfill', name: 'حشو مؤقت (كافيت)', category: 'حشوات', unit: 'g', minQty: 20 },
];

/** Recipes by procedure name → [item key, qty, per]. per: 'completion' | 'session'. */
export const SEED_RECIPES = {
  'حشو تجميلي عالي الجودة': [['composite', 0.3, 'completion'], ['bond', 1, 'completion'], ['etch', 1, 'completion'], ['anesthesia', 1, 'completion'], ['gloves', 1, 'completion']],
  'حشو تجميلي اقتصادي': [['composite', 0.3, 'completion'], ['bond', 1, 'completion'], ['etch', 1, 'completion'], ['anesthesia', 1, 'completion'], ['gloves', 1, 'completion']],
  'حشو مؤقت': [['tempfill', 0.5, 'completion'], ['gloves', 1, 'completion']],
};
