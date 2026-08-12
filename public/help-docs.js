/* Help centre articles, shared by both portals.
   Each article carries an English and an Arabic version; the panel's existing
   EN/AR selector picks between them. Body is a small subset of markdown —
   ## heading, - bullet, **bold** — rendered by helpDocRender() in the portals. */
window.HELP_DOCS = [
  {
    id: 'getting-started',
    title: { en: 'Getting started', ar: 'البداية' },
    body: {
      en: `## What MotoLinker is
MotoLinker runs the whole car-brokerage flow in one place: a lead arrives, becomes a
deal, gets a quotation, then a contract, then a purchase order to a supplier, and
finally a vehicle in stock assigned to a client.

## Finding your way around
- **Home** is what you see when you sign in. It is yours to arrange — see *Customising Home*.
- The **sidebar** groups every section. The admin can reorder and rename these, and the
  layout is shared with the team portal.
- The **bell** shows notifications; the **question mark** beside it opens this panel.

## Your place is remembered
Whichever section you are on is kept when you refresh or come back later.`,
      ar: `## ما هو MotoLinker
يدير MotoLinker دورة عمل وساطة السيارات بالكامل في مكان واحد: يصل العميل المحتمل،
يتحول إلى صفقة، ثم عرض سعر، ثم عقد، ثم أمر شراء للمورد، وأخيراً سيارة في المخزون
مخصصة للعميل.

## التنقل
- **الرئيسية** هي أول ما تراه عند تسجيل الدخول، ويمكنك ترتيبها كما تشاء.
- **القائمة الجانبية** تجمع كل الأقسام، ويمكن للمسؤول إعادة ترتيبها وتسميتها،
  ويسري الترتيب على بوابة الفريق أيضاً.
- **الجرس** يعرض الإشعارات، وعلامة **الاستفهام** بجواره تفتح هذه اللوحة.

## يتم تذكر مكانك
القسم الذي تعمل عليه يبقى كما هو عند تحديث الصفحة أو العودة لاحقاً.`,
    },
  },
  {
    id: 'home',
    title: { en: 'Customising Home', ar: 'تخصيص الرئيسية' },
    body: {
      en: `## Editing the layout
Press **Edit layout** on Home. Each widget then shows three controls:
- a **width** menu — quarter, third, half or full
- a **height** toggle — short or tall
- a **remove** button

Drag a widget by its body to move it; drop it on the left half of another widget to
land before it, or the right half to land after. **Add widget** offers everything not
already on the page, and **Reset** restores the default arrangement.

Press **Done** to save. Your layout is yours alone — changing it does not affect anyone else.

## What the numbers mean
Every widget is scoped to you. A sales rep sees their own tasks, their own leads and
their own pipeline; the admin sees the whole company. This is the same rule the reports
use, so the two always agree.`,
      ar: `## تعديل التخطيط
اضغط **تعديل التخطيط** في الرئيسية، فيظهر لكل أداة ثلاثة عناصر تحكم:
- قائمة **العرض** — ربع أو ثلث أو نصف أو كامل
- زر **الارتفاع** — قصير أو طويل
- زر **الحذف**

اسحب الأداة لتحريكها، وأفلتها على النصف الأيسر من أداة أخرى لتسبقها أو على النصف
الأيمن لتليها. زر **إضافة أداة** يعرض كل ما ليس موجوداً بالفعل، و**إعادة تعيين**
يستعيد الترتيب الافتراضي.

اضغط **تم** للحفظ. التخطيط خاص بك وحدك ولا يؤثر على غيرك.

## ماذا تعني الأرقام
كل أداة محدودة بنطاقك: مندوب المبيعات يرى مهامه وعملاءه وصفقاته فقط، بينما يرى
المسؤول الشركة كلها. وهي نفس القاعدة المستخدمة في التقارير، فتتطابق الأرقام دائماً.`,
    },
  },
  {
    id: 'leads',
    title: { en: 'Leads', ar: 'العملاء المحتملون' },
    body: {
      en: `## Adding leads
Add one by hand, or import a CSV in bulk. The importer matches your column headers to
the fields it knows and shows a preview before anything is written.

## Columns are yours to shape
Open the column settings to reorder, rename, hide or add columns. A column you add is a
custom field and behaves like any other — filterable, sortable, importable.

## Filtering
**Add filter** builds a condition on *any* column, built-in or custom. The operator
follows the column type: a dropdown offers *is / is not*, text offers *contains*, numbers
and dates offer *between*, and a checkbox offers *yes / no*. Filters stack, show as
removable chips, and survive a reload.

## Follow-ups
A follow-up is a dated reminder attached to a lead. Anything due shows on Home.`,
      ar: `## إضافة العملاء
أضف عميلاً يدوياً أو استورد ملف CSV دفعة واحدة. يطابق المستورد رؤوس الأعمدة مع
الحقول المعروفة ويعرض معاينة قبل الحفظ.

## الأعمدة قابلة للتشكيل
افتح إعدادات الأعمدة لإعادة الترتيب أو التسمية أو الإخفاء أو الإضافة. العمود الذي
تضيفه يصبح حقلاً مخصصاً يعمل مثل غيره تماماً — قابل للتصفية والترتيب والاستيراد.

## التصفية
زر **إضافة تصفية** يبني شرطاً على *أي* عمود. يتبع المُعامل نوع العمود: القائمة
المنسدلة تعطي *يساوي / لا يساوي*، والنص *يحتوي*، والأرقام والتواريخ *بين*،
وخانة الاختيار *نعم / لا*. تتراكم عوامل التصفية وتظهر كوسوم قابلة للحذف وتبقى بعد
تحديث الصفحة.

## المتابعات
المتابعة تذكير مؤرخ مرتبط بعميل، وكل ما يستحق يظهر في الرئيسية.`,
    },
  },
  {
    id: 'deals',
    title: { en: 'Deals and the pipeline', ar: 'الصفقات ومسار البيع' },
    body: {
      en: `## Stages
A deal moves through lead, contacted, quoted, negotiating, and ends won or lost. Drag a
card between columns on the board, or change the stage in the deal itself.

## Won deals generate a contract
Moving a deal to **won** creates the Arabic purchase-and-import contract automatically,
prefilled from the lead and the vehicle. Find it under Tools → Contracts, or attached to
the lead.

## Sales
The Sales tab records a car that has actually been sold — client, consignee, VIN,
colour, payment type and the client's file.`,
      ar: `## المراحل
تمر الصفقة بمراحل: عميل محتمل، تم التواصل، تم التسعير، تفاوض، ثم تنتهي بالربح أو
الخسارة. اسحب البطاقة بين الأعمدة أو غيّر المرحلة من داخل الصفقة.

## الصفقات الرابحة تُنشئ عقداً
عند نقل الصفقة إلى **رابحة** يُنشأ عقد شراء واستيراد سيارة بالعربية تلقائياً، معبأ
ببيانات العميل والسيارة. تجده في الأدوات ← العقود أو مرفقاً بالعميل.

## المبيعات
تسجل صفحة المبيعات سيارة تم بيعها فعلاً: العميل والمرسل إليه ورقم الشاسيه واللون
وطريقة الدفع وملف العميل.`,
    },
  },
  {
    id: 'quotations',
    title: { en: 'Quotations and contracts', ar: 'عروض الأسعار والعقود' },
    body: {
      en: `## Quotations
Build a quotation from the vehicle, price and terms, then export a PDF. Two designs are
available and you pick per quotation; both carry the same information and the company logo.

## Contracts
Contracts are the Arabic import-and-purchase agreement. One is generated automatically
when a deal is won, and you can also create one by hand. Both attach to the lead.

## Purchase orders and RFQs
An **RFQ** asks a supplier to quote a list of vehicles. A **purchase order** commits to
buying them. Both export as PDFs and attach to the lead they belong to.`,
      ar: `## عروض الأسعار
أنشئ عرض سعر من السيارة والسعر والشروط ثم صدّره PDF. يوجد تصميمان تختار بينهما لكل
عرض، وكلاهما يحمل نفس البيانات وشعار الشركة.

## العقود
العقود هي اتفاقية شراء واستيراد سيارة بالعربية. يُنشأ العقد تلقائياً عند ربح الصفقة،
ويمكنك أيضاً إنشاؤه يدوياً، وكلاهما يُرفق بالعميل.

## أوامر الشراء وطلبات التسعير
**طلب التسعير** يطلب من المورد تسعير قائمة سيارات، و**أمر الشراء** يلتزم بشرائها.
كلاهما يُصدَّر PDF ويُرفق بالعميل التابع له.`,
    },
  },
  {
    id: 'stock',
    title: { en: 'Inventory and suppliers', ar: 'المخزون والموردون' },
    body: {
      en: `## Inventory
Each model carries a spec sheet — range, motor, power train, drive train, transmission,
battery, top speed, fast charge, seats, body and year — plus the individual cars held.

## Suppliers
A supplier record holds the contact details and the vehicles that supplier offers. RFQs
and purchase orders draw from it, so prices and lead times stay consistent.`,
      ar: `## المخزون
يحمل كل طراز بطاقة مواصفات — المدى والمحرك ونظام القدرة ونظام الدفع وناقل الحركة
والبطارية والسرعة القصوى والشحن السريع وعدد المقاعد والهيكل وسنة الصنع — إضافة إلى
السيارات الموجودة فعلياً.

## الموردون
يحتوي سجل المورد على بيانات التواصل والسيارات التي يوفرها، وتعتمد عليه طلبات التسعير
وأوامر الشراء حتى تظل الأسعار ومدد التوريد متسقة.`,
    },
  },
  {
    id: 'chat-huddles',
    title: { en: 'Chat and huddles', ar: 'المحادثة والمكالمات' },
    body: {
      en: `## Chat
Direct messages and groups, with files, voice notes, replies, forwarding and editing.
Your status shows next to your name everywhere — set it from your profile.

## Huddles
Press the headphones icon in any conversation to start a call, or the camera icon to
start with video. Others get a prompt; anyone else sees a *Huddle in progress* chip.

During a call you can mute, turn the camera on, share a screen, and pull in anyone from
the workspace. Someone invited who is not in that conversation joins **as a guest** —
they get the call, not its message history.

- **Full screen** — the expand button on a tile, or double-click the video. Best way to
  read someone's shared screen.
- **Move it** — drag the widget by its header. Collapse it to a pill or maximise it with
  the buttons there.
- **Connection** — the bars on each tile show that person's call quality. Hover for
  packet loss and round-trip time.

A call is capped at six people, because every participant connects directly to every
other one.`,
      ar: `## المحادثة
رسائل مباشرة ومجموعات، مع الملفات والرسائل الصوتية والرد وإعادة التوجيه والتعديل.
تظهر حالتك بجوار اسمك في كل مكان، ويمكنك ضبطها من ملفك الشخصي.

## المكالمات
اضغط أيقونة السماعة في أي محادثة لبدء مكالمة، أو أيقونة الكاميرا للبدء بالفيديو.
يصل تنبيه للآخرين، ويرى الباقون شارة *مكالمة جارية*.

أثناء المكالمة يمكنك كتم الصوت وتشغيل الكاميرا ومشاركة الشاشة وضم أي شخص في مساحة
العمل. من يُدعى وهو خارج المحادثة ينضم **كضيف**: يحصل على المكالمة دون سجل الرسائل.

- **ملء الشاشة** — زر التكبير على البطاقة أو نقرة مزدوجة على الفيديو، وهو الأنسب
  لقراءة شاشة مشتركة.
- **التحريك** — اسحب النافذة من شريطها العلوي، ويمكنك طيّها أو تكبيرها من أزراره.
- **جودة الاتصال** — الأعمدة على كل بطاقة تبيّن جودة اتصال ذلك الشخص، ومرّر المؤشر
  لرؤية نسبة الفقد وزمن الرحلة.

الحد الأقصى ستة أشخاص، لأن كل مشارك يتصل بكل الآخرين مباشرة.`,
    },
  },
  {
    id: 'permissions',
    title: { en: 'Permissions and approvals', ar: 'الصلاحيات والموافقات' },
    body: {
      en: `## Per-section permissions
The admin turns each section on or off per employee, and within a section chooses which
actions are allowed — view, create, edit, delete, export.

## Data scope
Beyond actions, an employee can be limited to their **own** records: only leads assigned
to them, only certain lead statuses, only certain deal stages. Reports and Home honour the
same scope, so an employee never sees a company-wide total.

## Approvals
An employee asking to delete a record raises a request instead. The admin reviews it under
**Approvals** and the record is only removed once approved.`,
      ar: `## صلاحيات الأقسام
يفعّل المسؤول كل قسم أو يعطّله لكل موظف، ويختار داخل القسم الإجراءات المسموحة:
العرض والإنشاء والتعديل والحذف والتصدير.

## نطاق البيانات
إضافة إلى الإجراءات، يمكن حصر الموظف في سجلاته **الخاصة**: العملاء المسندون إليه فقط،
أو حالات محددة، أو مراحل صفقات بعينها. وتلتزم التقارير والرئيسية بنفس النطاق، فلا يرى
الموظف أي إجمالي على مستوى الشركة.

## الموافقات
عندما يطلب موظف حذف سجل يُنشأ طلب بدلاً من الحذف، يراجعه المسؤول في **الموافقات**،
ولا يُحذف السجل إلا بعد الموافقة.`,
    },
  },
  {
    id: 'integrations',
    title: { en: 'Google and WhatsApp', ar: 'جوجل وواتساب' },
    body: {
      en: `## Calendar
Every task assigned to someone appears on that person's own Google Calendar, provided
they have connected their account under My Tasks. Editing the task updates the event;
unassigning removes it.

## Drive, Sheets and Gmail
Connect your Google account to browse your Drive files and Sheets, and to read and send
mail from inside the app.

## Google Chat
Real Google Chat spaces and messages appear in-app once an admin has configured it. It is
Workspace-only, and messages are polled rather than live.

## WhatsApp
The WhatsApp inbox links a number by QR code and keeps conversations beside the CRM.`,
      ar: `## التقويم
تظهر كل مهمة مسندة لشخص في تقويم جوجل الخاص به، بشرط أن يكون قد ربط حسابه من صفحة
مهامي. تعديل المهمة يحدّث الحدث، وإلغاء الإسناد يحذفه.

## درايف وشيتس وجيميل
اربط حساب جوجل لتصفح ملفاتك وجداولك، ولقراءة البريد وإرساله من داخل النظام.

## Google Chat
تظهر مساحات ورسائل Google Chat داخل النظام بعد أن يهيئها المسؤول. الخدمة متاحة
لحسابات Workspace فقط، والرسائل تُجلب دورياً لا لحظياً.

## واتساب
يربط صندوق واتساب رقماً عبر رمز QR ويعرض المحادثات بجوار نظام العملاء.`,
    },
  },
];
