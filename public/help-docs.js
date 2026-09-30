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
    id: 'assistant',
    title: { en: 'The AI assistant', ar: 'المساعد الذكي' },
    body: {
      en: `## Ask AI, on every page
The **Ask AI** button in the header (or **Ctrl/⌘+K**) opens the assistant. On a desktop it
docks beside the page — nothing is covered, drag its edge to resize it, and it stays open
across pages until you close it; on a phone it rises as a sheet. It reads the section you
are on — Leads, Deals, Purchase Orders, Inventory, Tasks and the rest — and only what your
own permissions let you see. Ask it to explain a figure, find something, work something out
or draft a message, in English or Arabic. Every calculation it makes is shown under the answer.

## It sees what you are looking at
Open a lead profile, a deal, a task, a supplier, a purchase order or a container and the
panel shows a **Looking at** chip. From then on *summarise this lead*, *what does this one
still owe?* or *draft a reminder for him* need no name — the open record is handed to the
assistant in full. The active tab, the search box and the filters travel with it. Press ×
on the chip to make it ignore the record.

## It follows records across the whole system
From any page it can pull one lead's whole story (activities, follow-ups, deals, quotations,
contracts, sales, payments and what is still owed, purchase orders, RFQs, website
submissions, tasks), one deal, one supplier (orders, RFQs, catalogue, cars in stock,
containers) or one VIN (stock unit, container and arrival date, purchase-order line, sale,
payments, customer), search everything by name, phone, number or VIN, and read another
section's figures — always only what you may see.

## The insights card
Each section starts with an **AI insights** card: highlights, risks and suggestions for
that section. **Refresh** asks again; **Hide** folds it and remembers.

## Proposed actions
Ask for something to be done — *schedule a follow-up with Ahmed on Thursday*, *make me a
task to chase PO-12*, *move this deal to negotiating*, *record the 50,000 down payment* —
and the assistant proposes it as a card with **Confirm**. Nothing is written until you
press it. A confirmed action runs exactly like doing it by hand: the same permission, the
same activity log, notifications and automations, with you as the author. It can schedule
or close a follow-up, create, update or comment on a task, change a lead's status or
details, log a call or note, assign a lead, open a deal, move or edit a deal or add a note
to it, file a request, log hours, record a payment or an expense, link a website submission
to a lead, and send a notification.

## When it is off
Without an AI provider on the server (Cloudflare Workers AI, or a Gemini key as the fallback) every AI surface says so. An admin can also switch
the assistant off for a person under Employees → AI assistant.`,
      ar: `## اسأل الذكاء الاصطناعي في كل صفحة
زر **Ask AI** في الأعلى (أو **Ctrl/⌘+K**) يفتح المساعد. على الحاسوب يلتصق بجانب الصفحة —
لا يغطي شيئاً، اسحب حافته لتغيير عرضه، ويبقى مفتوحاً بين الصفحات حتى تغلقه؛ وعلى الهاتف
يظهر كلوحة من الأسفل. يقرأ القسم الذي تعمل عليه — العملاء المحتملين، الصفقات، أوامر الشراء،
المخزون، المهام وغيرها — وفقط ما تسمح لك صلاحياتك برؤيته. اطلب منه شرح رقم أو البحث عن شيء
أو حساب شيء أو كتابة رسالة بالعربية أو الإنجليزية. كل حساب يقوم به يظهر تحت الإجابة.

## يرى ما تنظر إليه
افتح ملف عميل أو صفقة أو مهمة أو مورداً أو أمر شراء أو حاوية فتظهر في اللوحة شارة
**Looking at**. بعدها لا يحتاج *لخّص هذا العميل* أو *كم تبقّى على هذا؟* أو *اكتب له تذكيراً*
إلى ذكر اسم — السجل المفتوح يُسلَّم للمساعد كاملاً. ويرافقه التبويب النشط ومربع البحث
والفلاتر. اضغط × على الشارة ليتجاهل السجل.

## يتتبع السجلات عبر النظام كله
من أي صفحة يستطيع جلب قصة عميل كاملة (النشاط، المتابعات، الصفقات، عروض الأسعار، العقود،
المبيعات، المدفوعات والمتبقي، أوامر الشراء، طلبات عروض الأسعار، طلبات الموقع، المهام)،
أو صفقة، أو مورداً (الطلبات، طلبات العروض، الكتالوج، السيارات في المخزون، الحاويات)،
أو رقم هيكل VIN (الوحدة في المخزون، الحاوية وموعد الوصول، سطر أمر الشراء، البيع، المدفوعات،
العميل)، والبحث في كل شيء بالاسم أو الهاتف أو الرقم أو VIN، وقراءة أرقام قسم آخر — دائماً
فقط ما يحق لك رؤيته.

## بطاقة الرؤى
يبدأ كل قسم ببطاقة **رؤى الذكاء الاصطناعي**: أبرز النقاط والمخاطر والاقتراحات لذلك القسم.
**Refresh** يسأل مجدداً؛ **Hide** يطويها ويتذكر ذلك.

## الإجراءات المقترحة
اطلب تنفيذ شيء — *حدّد متابعة مع أحمد يوم الخميس*، *أنشئ لي مهمة لمتابعة PO-12* — فيقترحه
المساعد كبطاقة مع زر **Confirm**. لا يُكتب شيء قبل الضغط عليه. الإجراء المؤكد يعمل تماماً
كما لو نفذته يدوياً: نفس الصلاحية ونفس سجل النشاط والإشعارات والأتمتة، وأنت المؤلف. يستطيع
تحديد متابعة أو إغلاقها، وإنشاء مهمة أو تحديثها أو التعليق عليها، وتغيير حالة عميل أو بياناته،
وتسجيل مكالمة أو ملاحظة، وإسناد عميل، وفتح صفقة، ونقل صفقة أو تعديلها أو إضافة ملاحظة لها،
وتقديم طلب، وتسجيل ساعات، وتسجيل دفعة أو مصروف، وربط طلب من الموقع بعميل، وإرسال إشعار.

## عندما يكون متوقفاً
بدون مزوّد ذكاء اصطناعي على الخادم (Cloudflare Workers AI، أو مفتاح Gemini كبديل) تقول كل واجهة ذلك صراحةً. ويمكن للمسؤول أيضاً إيقاف
المساعد لشخص من قسم الموظفين ← المساعد الذكي.`,
    },
  },
  {
    id: 'accounting',
    title: { en: 'Accounting and the finance AI', ar: 'المحاسبة والمساعد المالي' },
    body: {
      en: `## What it shows
Accounting (under **Finance**) puts the company's money in one place. Every figure is
computed from the payments ledger, the sales register, purchase orders and the expenses
table — company-wide, in EGP. It needs the **accounting** permission; an admin grants it
under Employees, or applies the **Accountant** preset.

## The tabs
- **Overview** — cash in, cash out, net cash, receivables, vehicle costs, gross margin, expenses and the net result for the chosen period, with cash flow by month.
- **Receivables** — every sale with money still owed, aged (not yet due, 1–30, 31–60, 61–90, over 90 days). Sort by any column.
- **Payables & costs** — supplier, freight and customs payments, purchase orders with their PI totals, and the last USD rate booked.
- **Expenses** — rent, salaries, marketing and the rest. **+ Expense** records one, with a receipt; a non-EGP amount needs the rate it was paid at.
- **Ledger** — every payment, filterable, with CSV export.
- **Reports** — pick a period and language and press **Generate**: the figures are computed, the AI writes the analysis, and the report is kept. Open it later, export it as PDF.

## The colourful brain
The brain button opens the **finance AI**. It reads the same figures the page shows and
answers in English or Arabic. When it does arithmetic it uses a calculator on the server
and shows the working under the answer — it never guesses a number. Each tab also carries
an AI card with highlights, risks and suggestions; **Refresh** asks again.

## When the AI is off
Without an AI provider on the server (Cloudflare Workers AI, or a Gemini key as the fallback) every AI surface says so. Everything else — the
figures, the ledger, expenses, CSV and PDF — keeps working.`,
      ar: `## ماذا يعرض
قسم المحاسبة (تحت **Finance**) يجمع أموال الشركة في مكان واحد. كل رقم محسوب من دفتر
المدفوعات وسجل المبيعات وأوامر الشراء وجدول المصروفات — على مستوى الشركة وبالجنيه المصري.
يحتاج صلاحية **accounting**؛ يمنحها المسؤول من قسم الموظفين أو بتطبيق قالب **Accountant**.

## التبويبات
- **Overview** — النقد الوارد والصادر وصافي النقد والمستحقات وتكاليف السيارات وهامش الربح والمصروفات وصافي النتيجة للفترة المختارة، مع التدفق النقدي الشهري.
- **Receivables** — كل بيعة ما زال عليها مبلغ، مصنفة حسب العمر (غير مستحق بعد، 1–30، 31–60، 61–90، أكثر من 90 يوماً). رتّب بأي عمود.
- **Payables & costs** — مدفوعات الموردين والشحن والجمارك، وأوامر الشراء بإجمالي فواتيرها الأولية، وآخر سعر دولار مسجّل.
- **Expenses** — الإيجار والرواتب والتسويق وغيرها. **+ Expense** يسجّل مصروفاً مع إيصال؛ المبلغ بغير الجنيه يحتاج سعر الصرف الذي دُفع به.
- **Ledger** — كل المدفوعات مع فلاتر وتصدير CSV.
- **Reports** — اختر الفترة واللغة واضغط **Generate**: تُحسب الأرقام ويكتب الذكاء الاصطناعي التحليل ويُحفظ التقرير. افتحه لاحقاً وصدّره PDF.

## الدماغ الملوّن
زر الدماغ يفتح **المساعد المالي**. يقرأ الأرقام نفسها المعروضة في الصفحة ويجيب بالعربية أو
الإنجليزية. عندما يحسب شيئاً يستخدم آلة حاسبة على الخادم ويُظهر طريقة الحساب تحت الإجابة —
لا يخمّن رقماً أبداً. كل تبويب يحمل أيضاً بطاقة ذكاء اصطناعي بأبرز النقاط والمخاطر والاقتراحات؛
**Refresh** يسأل من جديد.

## عندما يكون الذكاء الاصطناعي متوقفاً
بدون مزوّد ذكاء اصطناعي على الخادم (Cloudflare Workers AI، أو مفتاح Gemini كبديل) تقول كل واجهة ذكاء اصطناعي ذلك صراحةً. كل ما عدا ذلك —
الأرقام والدفتر والمصروفات وCSV وPDF — يعمل كالمعتاد.`,
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
