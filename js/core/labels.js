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
  expenses: 'مصروف',
  procedures: 'إجراء',
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
};

export const AUDIT_ACTION_TONES = {
  create: 'success', update: 'info', delete: 'danger', restore: 'primary',
  login: '', logout: '', login_failed: 'warning', lock: '',
  password_reset: 'warning', password_change: 'info', recovery_used: 'danger',
  recovery_regenerated: 'warning', setup: 'primary',
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
};

/** Fields never shown or stored in audit diffs. */
export const SECRET_FIELDS = new Set(['password', 'pin', 'recovery']);
/** Bookkeeping fields that are not interesting in a diff. */
export const META_FIELDS = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'deletedBy', 'lastLoginAt']);
