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
  media: 'صورة / أشعة',
  backup: 'النسخ الاحتياطي',
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
};

export const AUDIT_ACTION_TONES = {
  create: 'success', update: 'info', delete: 'danger', restore: 'primary',
  login: '', logout: '', login_failed: 'warning', lock: '',
  password_reset: 'warning', password_change: 'info', recovery_used: 'danger',
  recovery_regenerated: 'warning', setup: 'primary',
  backup_export: 'success', backup_restore: 'danger',
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
};

export const TREATMENT_STATUS = {
  planned: { label: 'مخطط', tone: 'primary' },
  in_progress: { label: 'جاري', tone: 'warning' },
  done: { label: 'تم', tone: 'success' },
  cancelled: { label: 'ملغي', tone: '' },
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
export const META_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedBy', 'lastLoginAt', 'searchText']);
