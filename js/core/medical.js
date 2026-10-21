/**
 * Medical history checklist. `level` decides how loudly an item is shown:
 *   critical → red banner at the top of the patient file and on appointments
 *   caution  → amber chip in the same banner
 *   info     → listed in the history only
 * A patient's history is stored as patient.medical = { items: { key: true }, allergyOther,
 * medications, notes, updatedAt, updatedBy }.
 */

/** @typedef {{ key: string, label: string, level: 'critical'|'caution'|'info', hint?: string, female?: boolean }} MedicalItem */

/** @type {{ title: string, items: MedicalItem[] }[]} */
export const MEDICAL_GROUPS = [
  {
    title: 'الحساسية',
    items: [
      { key: 'allergyPenicillin', label: 'حساسية من البنسلين', level: 'critical' },
      { key: 'allergyAnesthesia', label: 'حساسية من البنج الموضعي', level: 'critical' },
      { key: 'allergyLatex', label: 'حساسية من اللاتكس (الجوانتي)', level: 'critical' },
      { key: 'allergyNsaids', label: 'حساسية من المسكنات (أسبرين/بروفين)', level: 'critical' },
    ],
  },
  {
    title: 'القلب والدم',
    items: [
      { key: 'heartDisease', label: 'أمراض القلب / صمامات / دعامات', level: 'critical' },
      { key: 'anticoagulants', label: 'أدوية سيولة (مثل الوارفارين أو الأسبرين اليومي)', level: 'critical', hint: 'خطر نزيف عند الخلع والجراحة' },
      { key: 'bleedingDisorder', label: 'سيولة أو اضطراب في تجلط الدم', level: 'critical' },
      { key: 'hypertension', label: 'ضغط مرتفع', level: 'caution' },
      { key: 'rheumaticFever', label: 'حمى روماتيزمية سابقة', level: 'caution' },
    ],
  },
  {
    title: 'أمراض مزمنة',
    items: [
      { key: 'diabetes', label: 'سكري', level: 'caution', hint: 'التئام أبطأ للجروح' },
      { key: 'asthma', label: 'ربو / حساسية صدر', level: 'caution' },
      { key: 'epilepsy', label: 'صرع / تشنجات', level: 'caution' },
      { key: 'kidneyDisease', label: 'أمراض الكلى', level: 'caution' },
      { key: 'liverDisease', label: 'أمراض الكبد', level: 'caution' },
      { key: 'thyroid', label: 'الغدة الدرقية', level: 'info' },
    ],
  },
  {
    title: 'العدوى',
    items: [
      { key: 'hepatitis', label: 'التهاب كبدي فيروسي (B أو C)', level: 'critical' },
      { key: 'hiv', label: 'HIV', level: 'critical' },
    ],
  },
  {
    title: 'أدوية وعلاجات خاصة',
    items: [
      { key: 'bisphosphonates', label: 'أدوية هشاشة العظام (بيسفوسفونات)', level: 'critical', hint: 'خطر عند الخلع والزراعة' },
      { key: 'radiotherapy', label: 'علاج إشعاعي للرأس أو الرقبة', level: 'critical' },
      { key: 'chemotherapy', label: 'علاج كيماوي حالي', level: 'critical' },
      { key: 'steroids', label: 'كورتيزون لفترات طويلة', level: 'caution' },
    ],
  },
  {
    title: 'أخرى',
    items: [
      { key: 'pregnancy', label: 'حمل', level: 'critical', female: true, hint: 'تجنّب الأشعة وبعض الأدوية' },
      { key: 'breastfeeding', label: 'رضاعة طبيعية', level: 'caution', female: true },
      { key: 'smoker', label: 'مدخّن', level: 'info' },
      { key: 'previousSurgery', label: 'عمليات جراحية سابقة', level: 'info' },
    ],
  },
];

export const MEDICAL_ITEMS = MEDICAL_GROUPS.flatMap((g) => g.items);
const BY_KEY = Object.fromEntries(MEDICAL_ITEMS.map((i) => [i.key, i]));

export const emptyMedical = () => ({ items: {}, allergyOther: '', medications: '', notes: '', updatedAt: null, updatedBy: null });

/**
 * Alerts to show for a patient, most severe first.
 * "Other allergy" text counts as critical.
 * @returns {{ critical: string[], caution: string[] }}
 */
export function medicalAlerts(patient) {
  const m = patient?.medical;
  const critical = [], caution = [];
  if (!m) return { critical, caution };
  for (const [key, on] of Object.entries(m.items ?? {})) {
    if (!on || !BY_KEY[key]) continue;
    const item = BY_KEY[key];
    if (item.female && patient.gender === 'male') continue;
    if (item.level === 'critical') critical.push(item.label);
    else if (item.level === 'caution') caution.push(item.label);
  }
  if (m.allergyOther?.trim()) critical.push(`حساسية: ${m.allergyOther.trim()}`);
  return { critical, caution };
}

export const hasCriticalAlert = (patient) => medicalAlerts(patient).critical.length > 0;
