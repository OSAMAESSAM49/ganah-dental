/**
 * Phase 8 starter data: post-op instruction templates (Arabic), default follow-up schedules,
 * a list of common dental medicines (English names, Arabic directions) and prescription
 * templates. Everything is editable in the app. Doses are common defaults only — the
 * prescribing doctor reviews every prescription.
 */

export const SEED_INSTRUCTIONS = [
  { id: 'tpl-extraction', name: 'بعد الخلع', body: '• اضغط على القطنة لمدة 30–45 دقيقة.\n• لا تمضمض ولا تبصق لمدة 24 ساعة.\n• ضع كمادات باردة على الخد من الخارج 10 دقائق كل ساعة في أول يوم.\n• تناول أكلًا طريًا وباردًا أو فاترًا، وتجنّب المشروبات الساخنة اليوم.\n• لا تدخّن ولا تشرب بالشفاطة لمدة 3 أيام.\n• بعد 24 ساعة: مضمضة بماء دافئ وملح بعد الأكل.\n• تناول الأدوية الموصوفة في مواعيدها.\n• اتصل بنا إذا استمر النزيف أو زاد التورم أو الألم بشدة.' },
  { id: 'tpl-surgery', name: 'بعد جراحة الفم أو الزراعة', body: '• اتبع تعليمات ما بعد الخلع تمامًا.\n• الكمادات الباردة أول 48 ساعة تقلل التورم.\n• لا تلمس مكان الجراحة بلسانك أو إصبعك.\n• نم ورأسك مرتفع قليلًا أول ليلتين.\n• تجنّب المجهود العنيف لمدة 3 أيام.\n• موعد فك الغرز/المتابعة بعد أسبوع تقريبًا.' },
  { id: 'tpl-rct', name: 'بعد حشو العصب', body: '• قد تشعر بألم بسيط عند العض لعدة أيام وهذا طبيعي.\n• تجنّب المضغ على السن المعالج حتى تركيب الحشو النهائي أو الكراون.\n• تناول المسكن عند الحاجة حسب الروشتة.\n• يُنصح بتركيب كراون للسن لحمايته من الكسر.\n• اتصل بنا إذا حدث تورم أو ألم شديد.' },
  { id: 'tpl-filling', name: 'بعد الحشو', body: '• انتظر حتى يزول أثر البنج قبل الأكل لتجنّب عضّ الخد أو اللسان.\n• قد تشعر بحساسية خفيفة للبارد والساخن لأيام قليلة.\n• إذا شعرت أن الحشو مرتفع عند العض، تواصل معنا لتعديله.\n• حافظ على تنظيف أسنانك بالفرشاة والخيط.' },
  { id: 'tpl-cleaning', name: 'بعد تنظيف الجير', body: '• قد تشعر بحساسية أو نزيف بسيط باللثة ليوم أو يومين.\n• استخدم فرشاة ناعمة ومعجونًا للأسنان الحساسة.\n• استخدم الغسول الموصوف لمدة أسبوع.\n• يُنصح بالتنظيف كل 6 أشهر.' },
  { id: 'tpl-whitening', name: 'بعد التبييض', body: '• تجنّب الشاي والقهوة والمياه الغازية والأطعمة الملوّنة لمدة 48 ساعة.\n• لا تدخّن لمدة 48 ساعة على الأقل.\n• الحساسية المؤقتة طبيعية وتزول خلال أيام.\n• استخدم معجونًا للأسنان الحساسة.' },
  { id: 'tpl-crown', name: 'بعد تركيب الكراون أو الكوبري', body: '• تجنّب الأكل الصلب أو اللزج على التركيبة أول 24 ساعة.\n• نظّف حول التركيبة جيدًا، واستخدم خيط الأسنان أو فرشاة ما بين الأسنان للكوبري.\n• إذا شعرت أن العضة غير مريحة، تواصل معنا لتعديلها.' },
];

/** Default follow-up schedules: [offsetDays, type, note]. type: call | check | recall. */
export const SEED_SCHEDULES = [
  [/خلع (جراحي|ضرس عقل)/, [[1, 'call', 'الاطمئنان بعد الخلع'], [7, 'check', 'فحص المتابعة وفك الغرز']]],
  [/خلع/, [[1, 'call', 'الاطمئنان بعد الخلع']]],
  [/عصب|بلبوتومي/, [[7, 'check', 'فحص المتابعة بعد حشو العصب']]],
  [/تنظيف جير/, [[180, 'recall', 'الفحص والتنظيف الدوري']]],
  [/تبييض/, [[2, 'call', 'الاطمئنان بعد التبييض']]],
  [/كراون|كوبري|فينير/, [[7, 'call', 'الاطمئنان بعد التركيب']]],
  [/فلورايد|سيلانت/, [[180, 'recall', 'الفحص الدوري للأطفال']]],
];

export function instructionFor(name = '') {
  if (/خلع (جراحي|ضرس عقل)|زراعة/.test(name)) return 'tpl-surgery';
  if (/خلع/.test(name)) return 'tpl-extraction';
  if (/عصب|بلبوتومي/.test(name)) return 'tpl-rct';
  if (/حشو/.test(name)) return 'tpl-filling';
  if (/تنظيف|تلميع/.test(name)) return 'tpl-cleaning';
  if (/تبييض/.test(name)) return 'tpl-whitening';
  if (/كراون|كوبري|فينير|تاج/.test(name)) return 'tpl-crown';
  return null;
}

export function scheduleFor(name = '') {
  const hit = SEED_SCHEDULES.find(([re]) => re.test(name));
  return hit ? hit[1].map(([offsetDays, type, note]) => ({ offsetDays, type, note })) : [];
}

/**
 * Medicines. groups drive safety warnings against the medical history:
 *   penicillin → penicillin allergy · nsaid → NSAID allergy, anticoagulants, kidney, pregnancy
 *   pregnancy  → caution in pregnancy
 */
export const SEED_MEDICINES = [
  { id: 'med-amox500', name: 'Amoxicillin 500 mg', form: 'capsule', category: 'antibiotic', dose: 'كبسولة كل 8 ساعات', duration: '5 أيام', groups: ['penicillin'] },
  { id: 'med-augmentin1g', name: 'Amoxicillin + Clavulanate 1 g (Augmentin)', form: 'tablet', category: 'antibiotic', dose: 'قرص كل 12 ساعة بعد الأكل', duration: '5 أيام', groups: ['penicillin'] },
  { id: 'med-azithro', name: 'Azithromycin 500 mg', form: 'tablet', category: 'antibiotic', dose: 'قرص مرة يوميًا', duration: '3 أيام', groups: [] },
  { id: 'med-clinda', name: 'Clindamycin 300 mg', form: 'capsule', category: 'antibiotic', dose: 'كبسولة كل 8 ساعات', duration: '5 أيام', groups: [] },
  { id: 'med-metro', name: 'Metronidazole 500 mg (Flagyl)', form: 'tablet', category: 'antibiotic', dose: 'قرص كل 8 ساعات بعد الأكل', duration: '5 أيام', groups: ['pregnancy'], notes: 'تجنّب المشروبات الكحولية' },
  { id: 'med-ibu400', name: 'Ibuprofen 400 mg (Brufen)', form: 'tablet', category: 'analgesic', dose: 'قرص كل 8 ساعات بعد الأكل عند اللزوم', duration: '3 أيام', groups: ['nsaid'] },
  { id: 'med-ibu600', name: 'Ibuprofen 600 mg', form: 'tablet', category: 'analgesic', dose: 'قرص كل 12 ساعة بعد الأكل عند اللزوم', duration: '3 أيام', groups: ['nsaid'] },
  { id: 'med-diclo', name: 'Diclofenac potassium 50 mg (Cataflam)', form: 'tablet', category: 'analgesic', dose: 'قرص كل 8 ساعات بعد الأكل عند اللزوم', duration: '3 أيام', groups: ['nsaid'] },
  { id: 'med-para', name: 'Paracetamol 500 mg (Panadol)', form: 'tablet', category: 'analgesic', dose: 'قرصان كل 6–8 ساعات عند اللزوم (بحد أقصى 8 أقراص يوميًا)', duration: '3 أيام', groups: [] },
  { id: 'med-chx', name: 'Chlorhexidine 0.12% mouthwash', form: 'mouthwash', category: 'mouthwash', dose: 'مضمضة 15 مل لمدة 30 ثانية مرتين يوميًا بعد التفريش', duration: '7 أيام', groups: [], notes: 'لا تبلع الغسول، ولا تأكل لمدة 30 دقيقة بعده' },
  { id: 'med-miconazole', name: 'Miconazole oral gel (Daktarin)', form: 'gel', category: 'antifungal', dose: 'يُدهن على المكان 4 مرات يوميًا', duration: '7 أيام', groups: [] },
  { id: 'med-amoxsyr', name: 'Amoxicillin 250 mg / 5 ml suspension', form: 'syrup', category: 'antibiotic', dose: 'حسب وزن الطفل: ___ مل كل 8 ساعات', duration: '5 أيام', groups: ['penicillin'] },
  { id: 'med-ibusyr', name: 'Ibuprofen 100 mg / 5 ml suspension', form: 'syrup', category: 'analgesic', dose: 'حسب وزن الطفل: ___ مل كل 8 ساعات بعد الأكل', duration: '3 أيام', groups: ['nsaid'] },
  { id: 'med-parasyr', name: 'Paracetamol 120 mg / 5 ml syrup', form: 'syrup', category: 'analgesic', dose: 'حسب وزن الطفل: ___ مل كل 6 ساعات عند اللزوم', duration: '3 أيام', groups: [] },
];

export const SEED_RX_TEMPLATES = [
  { id: 'rx-abx-analgesic', name: 'مضاد حيوي + مسكن (بالغين)', meds: ['med-augmentin1g', 'med-ibu400'] },
  { id: 'rx-extraction', name: 'بعد الخلع', meds: ['med-augmentin1g', 'med-ibu400', 'med-chx'] },
  { id: 'rx-penicillin-allergy', name: 'حساسية البنسلين: مضاد حيوي بديل + مسكن', meds: ['med-clinda', 'med-para'] },
  { id: 'rx-rct', name: 'بعد حشو العصب', meds: ['med-ibu400'] },
  { id: 'rx-gum', name: 'التهاب اللثة', meds: ['med-metro', 'med-chx'] },
  { id: 'rx-kids', name: 'أطفال: مضاد حيوي + مسكن', meds: ['med-amoxsyr', 'med-ibusyr'] },
];
