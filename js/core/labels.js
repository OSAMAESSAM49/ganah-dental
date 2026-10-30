/** Arabic labels for stored enum values and field names (audit log, exports). */

export const ENTITY_LABELS = {
  users: 'مستخدم',
  roles: 'دور وصلاحيات',
  settings: 'الإعدادات',
  auth: 'تسجيل الدخول',
  patients: 'مريض',
  payments: 'دفعة',
  invoices: 'فاتورة',
  inventoryItems: 'صنف مخزون',
  stockMovements: 'حركة مخزون',
  appointments: 'موعد',
  treatmentItems: 'بند علاج',
  treatmentPlans: 'خطة علاج',
  toothEvents: 'خريطة الأسنان',
  expenses: 'مصروف',
  procedures: 'إجراء',
  procedureCategories: 'تصنيف إجراءات',
  expenseCategories: 'تصنيف مصروفات',
  recurringExpenses: 'مصروف شهري ثابت',
  labCases: 'حالة معمل',
  instructionTemplates: 'قالب تعليمات',
  followUps: 'متابعة',
  medicines: 'دواء',
  rxTemplates: 'قالب روشتة',
  prescriptions: 'روشتة',
  cases: 'ملف تقويم / زراعة',
  caseVisits: 'زيارة متابعة تقويم / زراعة',
  media: 'صورة / أشعة / ملاحظة صوتية',
  backup: 'النسخ الاحتياطي',
  import: 'استيراد بيانات',
  stockBatches: 'تشغيلة مخزون',
  auditLog: 'سجل العمليات',
  demo: 'بيانات تجريبية',
  sync: 'المزامنة السحابية',
};

export const AUDIT_ACTION_LABELS = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  restore: 'استعادة',
  login: 'دخول',
  logout: 'خروج',
  login_failed: 'محاولة دخول فاشلة',
  lock: 'قفل تلقائي',
  password_reset: 'إعادة تعيين كلمة المرور',
  password_change: 'تغيير كلمة المرور',
  recovery_used: 'استخدام رمز الاسترداد',
  recovery_regenerated: 'إنشاء رمز استرداد جديد',
  setup: 'إعداد أول مرة',
  backup_export: 'تنزيل نسخة احتياطية',
  backup_restore: 'استرجاع نسخة احتياطية',
  backup_merge: 'دمج نسخة من جهاز آخر',
  demo_create: 'إضافة بيانات تجريبية',
  demo_remove: 'حذف البيانات التجريبية',
  patients_export: 'تصدير بيانات كل المرضى',
  dentolize_import: 'استيراد من Dentolize',
  sync_connect: 'ربط الجهاز بالسحابة',
  sync_join: 'ربط جهاز إضافي بالسحابة',
};

export const AUDIT_ACTION_TONES = {
  create: 'success', update: 'info', delete: 'danger', restore: 'primary',
  login: '', logout: '', login_failed: 'warning', lock: '',
  password_reset: 'warning', password_change: 'info', recovery_used: 'danger',
  recovery_regenerated: 'warning', setup: 'primary',
  backup_export: 'success', backup_restore: 'danger', backup_merge: 'warning', demo_create: 'info', demo_remove: 'warning', sync_connect: 'primary', sync_join: 'primary', patients_export: 'warning', dentolize_import: 'warning',
};

export const FIELD_LABELS = {
  name: 'الاسم',
  displayName: 'الاسم الظاهر',
  username: 'اسم المستخدم',
  roleId: 'الدور',
  title: 'اللقب',
  isDoctor: 'طبيب معالج',
  active: 'مفعّل',
  permissions: 'الصلاحيات',
  permOverrides: 'صلاحيات خاصة',
  mustChangePassword: 'يجب تغيير كلمة المرور',
  color: 'اللون',
  phone: 'الهاتف',
  address: 'العنوان',
  shortName: 'الاسم المختصر',
  tagline: 'الوصف',
  logo: 'الشعار',
  digitStyle: 'شكل الأرقام',
  idleLogoutMinutes: 'الخروج التلقائي (دقائق)',
  backupReminderDays: 'تذكير النسخ الاحتياطي (أيام)',
  notes: 'ملاحظات',
  deletedAt: 'تاريخ الحذف',
  fileNo: 'رقم الملف',
  phone2: 'هاتف آخر',
  gender: 'النوع',
  dob: 'تاريخ الميلاد',
  dobEstimated: 'تاريخ ميلاد تقريبي',
  occupation: 'المهنة',
  referralSource: 'مصدر المعرفة',
  referralNote: 'تفاصيل المصدر',
  photo: 'الصورة',
  medical: 'التاريخ الطبي',
  price: 'السعر',
  durationMin: 'المدة (دقيقة)',
  sessions: 'عدد الجلسات',
  perTooth: 'لكل سن',
  needsLab: 'يحتاج معمل',
  categoryId: 'التصنيف',
  order: 'الترتيب',
  caption: 'الوصف',
  tag: 'قبل/بعد',
  takenAt: 'تاريخ التصوير',
  kind: 'النوع',
  chartEffect: 'أثره على الخريطة',
  status: 'الحالة',
  teeth: 'الأسنان',
  surfaces: 'الأسطح',
  unitPrice: 'سعر الوحدة',
  qty: 'الكمية',
  discountType: 'نوع الخصم',
  discountValue: 'قيمة الخصم',
  total: 'الإجمالي',
  sessionsPlanned: 'الجلسات المخططة',
  sessionsDone: 'الجلسات المنفذة',
  procedureName: 'الإجراء',
  planId: 'الخطة',
  condition: 'الحالة',
  tooth: 'السن',
  voided: 'ملغي',
  statusHistory: 'سجل الحالة',
  date: 'التاريخ',
  startMin: 'وقت البدء',
  duration: 'المدة',
  doctorId: 'الطبيب',
  chairId: 'الكرسي',
  procedureNames: 'الإجراءات',
  reason: 'سبب الزيارة',
  clinicalNotes: 'ملاحظات الطبيب',
  reminderSentAt: 'وقت إرسال التذكير',
  cancelReason: 'سبب الإلغاء',
  number: 'الرقم',
  receiptNo: 'رقم الإيصال',
  amount: 'المبلغ',
  method: 'طريقة الدفع',
  invoiceId: 'الفاتورة',
  lines: 'البنود',
  installments: 'الأقساط',
  appliedCredit: 'رصيد مستخدم',
  voidReason: 'سبب الإلغاء',
  voidedAt: 'تاريخ الإلغاء',
  unit: 'الوحدة',
  minQty: 'الحد الأدنى',
  costPerUnit: 'تكلفة الوحدة',
  supplier: 'المورد',
  category: 'الفئة',
  recipe: 'المواد المستهلكة',
  description: 'البيان',
  labName: 'المعمل',
  workType: 'نوع العمل',
  shade: 'اللون',
  sentAt: 'تاريخ الإرسال',
  expectedAt: 'الموعد المتوقع',
  receivedAt: 'تاريخ الاستلام',
  tryInAt: 'تاريخ التجربة',
  cementedAt: 'تاريخ التركيب',
  cost: 'التكلفة',
  dayOfMonth: 'يوم الاستحقاق',
  body: 'النص',
  instructionTemplateId: 'تعليمات ما بعد الإجراء',
  followUpSchedule: 'جدول المتابعة',
  dueDate: 'تاريخ الاستحقاق',
  dose: 'الجرعة',
  duration: 'المدة',
  form: 'الشكل',
  groups: 'مجموعات التحذير',
};

export const TREATMENT_STATUS = {
  planned: { label: 'مخطط', tone: 'primary' },
  in_progress: { label: 'جاري', tone: 'warning' },
  done: { label: 'تم', tone: 'success' },
  cancelled: { label: 'ملغي', tone: '' },
};

/** Stock units (key → Arabic label). */
export const UNITS = {
  piece: 'قطعة', pair: 'زوج', box: 'علبة', pack: 'باكيت', g: 'جم', ml: 'مل', drop: 'نقطة',
  dose: 'جرعة', carpule: 'كاربول', syringe: 'سرنجة', tube: 'أنبوبة', bottle: 'زجاجة', roll: 'رول', sheet: 'ورقة',
};

export const MOVEMENT_TYPES = {
  purchase: { label: 'استلام شراء', tone: 'success', sign: 1 },
  adjust_in: { label: 'تسوية بالزيادة', tone: 'info', sign: 1 },
  adjust_out: { label: 'تسوية بالنقص', tone: 'warning', sign: -1 },
  consume: { label: 'استهلاك علاج', tone: 'primary', sign: -1 },
  return: { label: 'إرجاع استهلاك', tone: 'info', sign: 1 },
};

export const ADJUST_REASONS = ['جرد', 'تالف', 'انتهت صلاحيته', 'استخدام خارج العلاج', 'خطأ في التسجيل', 'أخرى'];

export const LAB_STATUS = {
  sent: { label: 'في المعمل', tone: 'warning' },
  received: { label: 'استُلم من المعمل', tone: 'info' },
  try_in: { label: 'تمت التجربة', tone: 'primary' },
  cemented: { label: 'تم التركيب', tone: 'success' },
  cancelled: { label: 'ملغي', tone: '' },
};

export const LAB_WORK_TYPES = {
  crown: 'كراون', bridge: 'كوبري', veneer: 'فينير', denture: 'طقم', partial: 'طقم جزئي', night_guard: 'واقي ليلي',
  space_maintainer: 'حافظ مسافة', implant_crown: 'تاج على زرعة', other: 'أخرى',
};

export const FOLLOWUP_TYPES = {
  call: { label: 'اتصال للاطمئنان', short: 'اتصال', icon: 'phone', tone: 'info' },
  check: { label: 'فحص متابعة', short: 'فحص', icon: 'stethoscope', tone: 'primary' },
  recall: { label: 'استدعاء دوري', short: 'استدعاء', icon: 'repeat', tone: 'accent' },
};
export const FOLLOWUP_STATUS = {
  pending: { label: 'مطلوب', tone: 'warning' },
  done: { label: 'تم', tone: 'success' },
  skipped: { label: 'أُلغي', tone: '' },
};
export const MED_FORMS = {
  tablet: 'أقراص', capsule: 'كبسولات', syrup: 'شراب', mouthwash: 'غسول فم', gel: 'جل', ampoule: 'حقن', drops: 'نقط', cream: 'كريم', other: 'أخرى',
};
export const MED_CATEGORIES = {
  antibiotic: 'مضاد حيوي', analgesic: 'مسكن / مضاد التهاب', mouthwash: 'غسول', antifungal: 'مضاد فطريات', other: 'أخرى',
};

export const PAYMENT_METHODS = {
  cash: { label: 'نقدي', icon: 'banknote' },
  card: { label: 'بطاقة / فيزا', icon: 'wallet' },
  vodafone: { label: 'فودافون كاش', icon: 'phone' },
  instapay: { label: 'إنستاباي', icon: 'refresh-cw' },
};

export const INVOICE_STATUS = {
  open: { label: 'غير مدفوعة', tone: 'danger' },
  partial: { label: 'مدفوعة جزئيًا', tone: 'warning' },
  paid: { label: 'تم السداد', tone: 'success' },
  void: { label: 'مُبطلة', tone: '' },
};

/** Appointment arrival flow: booked → arrived → in_chair → done (or no_show / cancelled). */
/** What the buttons that move an appointment along say (same words everywhere). */
export const APPT_ACTIONS = { arrived: 'وصل', in_chair: 'دخل الكرسي', done: 'انتهت الزيارة', no_show: 'لم يحضر', cancelled: 'إلغاء الموعد' };

export const APPT_STATUS = {
  booked: { label: 'محجوز', tone: 'primary', color: '#4A0CD3' },
  arrived: { label: 'في الانتظار', tone: 'warning', color: '#D97706' },
  in_chair: { label: 'على الكرسي', tone: 'info', color: '#0284C7' },
  done: { label: 'انتهى', tone: 'success', color: '#16A34A' },
  no_show: { label: 'لم يحضر', tone: 'danger', color: '#DC2626' },
  cancelled: { label: 'ملغي', tone: '', color: '#94A3B8' },
};

export const PLAN_STATUS = {
  active: { label: 'معتمدة', tone: 'success' },
  proposal: { label: 'عرض بديل', tone: 'info' },
  rejected: { label: 'لم يُختر', tone: '' },
  completed: { label: 'مكتملة', tone: 'primary' },
};

export const GENDER_LABELS = { male: 'ذكر', female: 'أنثى' };

/** How the patient heard about the clinic (marketing reports). */
export const REFERRAL_SOURCES = {
  facebook: 'فيسبوك',
  instagram: 'إنستجرام',
  tiktok: 'تيك توك',
  google: 'جوجل / الخريطة',
  friend: 'صديق أو قريب',
  patient: 'مريض بالعيادة',
  sign: 'لافتة العيادة',
  doctor: 'طبيب آخر',
  other: 'أخرى',
};

/** Fields never shown or stored in audit diffs. */
export const SECRET_FIELDS = new Set(['password', 'pin', 'recovery']);
/** Bookkeeping fields that are not interesting in a diff. */
export const META_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedBy', 'lastLoginAt', 'searchText', '_rev']);
