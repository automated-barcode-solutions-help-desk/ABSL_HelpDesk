/* =====================================================================
   ABSL Helpdesk — User Guide text, in English, Sinhala and Tamil
   =====================================================================
   Loaded only by help.html, before app.js; helpPage() in app.js builds
   the page from it.

   **Double asterisks** mark what is written on the screen (buttons,
   headings, menu items). They stay in English in every language, because
   the app itself is in English and people need to find the same words.

   Pictures are in guide/ and are made by scripts/guide-screens/capture.js
   with sample data. Each language lists the same tasks in the same order;
   a task's `images` name pictures from GUIDE_IMAGES.
   ===================================================================== */

const GUIDE_IMAGES = {
  register: { src: "guide/register.webp", phone: true },
  login: { src: "guide/login.webp", phone: true },
  "office-menu": { src: "guide/office-menu.webp" },
  "customer-new-ticket": { src: "guide/customer-new-ticket.webp", phone: true },
  "customer-my-tickets": { src: "guide/customer-my-tickets.webp", phone: true },
  "customer-conversation": { src: "guide/customer-conversation.webp", phone: true },
  "customer-close": { src: "guide/customer-close.webp", phone: true },
  "tech-counts": { src: "guide/tech-counts.webp", phone: true },
  "tech-open-jobs": { src: "guide/tech-open-jobs.webp", phone: true },
  "tech-my-jobs": { src: "guide/tech-my-jobs.webp", phone: true },
  "tech-status": { src: "guide/tech-status.webp", phone: true },
  "tech-photos": { src: "guide/tech-photos.webp", phone: true },
  "tech-handover": { src: "guide/tech-handover.webp", phone: true },
  "tech-resolve": { src: "guide/tech-resolve.webp", phone: true },
  "tech-log-job": { src: "guide/tech-log-job.webp", phone: true },
  "my-reports-filters": { src: "guide/my-reports-filters.webp" },
  "my-reports-table": { src: "guide/my-reports-table.webp" },
  "operator-queue": { src: "guide/operator-queue.webp" },
  "operator-assign": { src: "guide/operator-assign.webp", phone: true },
  "operator-callbacks": { src: "guide/operator-callbacks.webp" },
  "operator-approvals": { src: "guide/operator-approvals.webp" },
  reports: { src: "guide/reports.webp" },
  "main-console-staff": { src: "guide/main-console-staff.webp" },
  "main-console-backup": { src: "guide/main-console-backup.webp" },
  "trip-planner": { src: "guide/trip-planner.webp" },
  "trip-planner-office": { src: "guide/trip-planner-office.webp" },
  "trip-planner-phone": { src: "guide/trip-planner-phone.webp", phone: true },
  "service-plan": { src: "guide/service-plan.webp" }
};

const GUIDE_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "si", name: "සිංහල" },
  { code: "ta", name: "தமிழ்" }
];

const GUIDE_CONTENT = {
  // -------------------------------------------------------------------
  en: {
    ui: {
      language: "Language",
      title: "User Guide",
      intro: "Everything you need for your first day: getting in, finding your way around, and getting a job done — with pictures of each screen.",
      toc: {
        start: "Getting started",
        navigation: "Finding your way",
        roles: "Guide for your role",
        tickets: "How a ticket moves",
        emails: "Emails you'll get",
        faq: "Common questions"
      },
      replayTour: "▶ Replay the welcome tour",
      rolesSignedIn: "Your own role is opened for you. Tap any other to read it.",
      rolesSignedOut: "Tap your role to read how to use it.",
      yourRole: "Your role",
      enlarge: "Tap a picture to see it full size. Pictures use sample data.",
      navNote: "Each portal has its own accent colour, so you can tell at a glance which one you're looking at.",
      startNote: "Operator and CEO accounts can't be requested when registering. Register as normal and the CEO will set your role.",
      emailsNote: "Emails come from ABSL Helpdesk. If you don't see one, check your spam or junk folder.",
      contact: "Still stuck? Email {email} — include your ticket number if it's about a job.",
      goDashboard: "Go to my dashboard",
      createAccount: "Create an account",
      login: "Login"
    },
    start: {
      intro: "ABSL Helpdesk is where Automated Barcode Solutions customers report problems with their barcode, printing and scanning equipment, and where ABSL staff take every job from first report to fix.",
      images: ["register", "login"],
      steps: [
        "**Create your account.** Open **Register**, choose **Customer** (or **Technician / Field Staff** if you work for ABSL), then enter your full name, company, email, phone number and a password. Press **Show** to check what you typed, then **Create Account**.",
        "**Verify your email.** Open the email we send and click the link — you can't sign in until you do.",
        "**Wait for approval, if needed.** Accounts on an email domain ABSL has verified are approved straight away. Personal email addresses and all field-staff requests are checked by ABSL first, and you're emailed when that's done.",
        "**Sign in.** Open **Login** and enter your email and password. You land on your own dashboard automatically. Forgot your password? Press **Forgot password?**.",
        "**First time in?** A short welcome tour shows you around. You can replay it any time from this page."
      ]
    },
    navigation: {
      image: "office-menu",
      items: [
        { title: "Top bar", body: "The dark bar at the very top: your connection status (**Connected** or **Offline**), **Help** (this guide) and **Sign Out**." },
        { title: "Menu bar", body: "Just below it. Customers see their own portal; technicians see theirs, **My Job Reports** and **Trip Planner**. Operators see **Dashboard**, **Reports**, **Approvals**, **Alerts**, **Notifications**, **Receipts**, **Client Errors** and **Service Plan** — and the CEO also sees **Main Console**." },
        { title: "Page header", body: "Your portal's name and what it's for, with your role and name on the right — so you always know which account you're signed in to." },
        { title: "Summary cards", body: "The numbers at the top of your dashboard: open tickets, jobs waiting for a technician, unread alerts and so on." },
        { title: "Lists and search", body: "Every ticket list has a search box plus status and priority filters. **See all** opens the complete list." },
        { title: "Ticket detail", body: "Press **Open** on any ticket and its full detail opens **below the lists** — scroll down. Status buttons, assigning, photos, replies and history are all there." }
      ]
    },
    roles: [
      {
        role: "customer",
        title: "Customer Portal",
        summary: "For customers reporting a problem and following it through to the fix.",
        tasks: [
          {
            title: "Raise a ticket",
            images: ["customer-new-ticket"],
            steps: [
              "In **Create New Ticket**, choose the **Job Type**: Service, Fault, Installation or Other.",
              "Add the **Department** that has the problem if it helps us find it (optional).",
              "Write a short **Problem Summary**, tick any **Common Problems** that apply, and add any other details.",
              "Set the **Priority** and the site **Location**. On a phone, **Use my location** fills in your GPS position.",
              "If someone else will meet the technician on site, add their **Site contact number**.",
              "Tick **Need phone callback?** if you'd rather talk to someone, then press **Submit Ticket**."
            ]
          },
          {
            title: "Follow your tickets",
            images: ["customer-my-tickets"],
            steps: [
              "Every ticket you raise is listed in **My Tickets** with its current status.",
              "Press **Open** on a ticket to see its full detail below the lists: the facts, photos, technician, conversation and history.",
              "Use the search box and filters to find an older ticket."
            ]
          },
          {
            title: "Talk to ABSL",
            images: ["customer-conversation"],
            steps: [
              "Write in the **Conversation** box at the bottom of a ticket and press **Send**. We email you whenever ABSL replies.",
              "Prefer a phone call? Use **Prefer a phone call?** on the ticket and enter your number."
            ]
          },
          {
            title: "Change or close a ticket",
            images: ["customer-close"],
            steps: [
              "While a ticket is still **New**, open **Edit ticket details** to correct it.",
              "When the job is done you'll get an email with the resolution notes and the service call number. Press **Closed** once you're happy."
            ]
          }
        ]
      },
      {
        role: "technician",
        title: "Technician Field App",
        summary: "For ABSL field technicians: your jobs, the open job pool, and logging your own work.",
        tasks: [
          {
            title: "Your job counts",
            images: ["tech-counts"],
            steps: [
              "The cards at the top count your jobs: **New** (given to you, not opened yet), **Assigned** (opened, not started), **Ongoing** (In Progress) and **Resolved** (resolved or closed).",
              "Tap a card to see exactly those jobs in My Job Reports."
            ]
          },
          {
            title: "Take a job from Open Jobs",
            images: ["tech-open-jobs"],
            steps: [
              "**Open Jobs** appears at the top of your page whenever a job has been released to every technician.",
              "Press **Open** on the job, choose your own name under **Technician → Assign or hand over**, and press **Assign**. The first technician to accept it gets it."
            ]
          },
          {
            title: "Work your jobs",
            images: ["tech-status", "tech-photos"],
            steps: [
              "**My Jobs** lists every job assigned to you. Press **Open** on one.",
              "Press **In Progress** when you start. Tap the site contact number to call, or **Open map** to find the site.",
              "Add photos as you go with **Add photo**, and keep the customer updated in the **Conversation**."
            ]
          },
          {
            title: "Resolve a job",
            images: ["tech-resolve"],
            steps: [
              "Press **Resolved**. Enter the **Service call number**, your **Resolution notes** and a **Receipt photo** — all three are required.",
              "Press **Resolve**. The customer is emailed your notes and the service call number, and the receipt is filed."
            ]
          },
          {
            title: "Hand a job to a colleague",
            images: ["tech-handover"],
            steps: [
              "Open the job, choose the colleague under **Assign or hand over**, add a reason, and press **Reassign**. The hand-over note appears in the conversation."
            ]
          },
          {
            title: "Log a job",
            images: ["tech-my-jobs", "tech-log-job"],
            steps: [
              "Press **Log a Job** for work that didn't come through the portal.",
              "A customer phoned you: enter the company, the caller's name and phone, the job type, the **Fault location** and the problem.",
              "A job you need to do yourself, with no caller: tick **This is my own job** — it's assigned to you straight away.",
              "Answer the question at the bottom: **Yes** opens it to every technician (it goes to Open Jobs); **No** assigns it to you. Then press **Log Job**."
            ]
          },
          {
            title: "Plan a trip with nearby services",
            images: ["trip-planner-phone"],
            steps: [
              "Going somewhere far? Open **Trip Planner** from the menu bar, or press **Plan a trip** on an open job.",
              "Choose where you're **Going to**: a job, a town, or the client sites around you. Pending services on the way are ticked; **Other client sites on the way** (nothing due there) can be ticked too.",
              "Long trips are split into days (set your **Driving day** and **Time at each stop**). Each day has its own Google Maps link; a one-day trip has **Open route in Google Maps**.",
              "**Share trip** sends the stops and links to WhatsApp; **Print trip sheet** prints them with space for service call numbers.",
              "At each stop press **Start service** (or **Start visit** where nothing is due): it becomes your job. Mark it **In Progress**, then **Resolved** with the service call number and receipt photo, and the service is marked done."
            ]
          },
          {
            title: "My Job Reports",
            images: ["my-reports-filters", "my-reports-table"],
            steps: [
              "Open **My Job Reports** from the menu bar. It lists every job assigned to you — only yours.",
              "Filter by **Job Status**, **Job Type**, **From Date** / **To Date**, **Service Call No** or **Customer Name** (any together), then press **Generate Report**. **Reset Filters** starts again.",
              "In the table, sort any column by its heading, filter each column from the row under the headings, or search the whole report.",
              "**Download Excel** saves an Excel file and **Print Report** prints just the report."
            ]
          }
        ]
      },
      {
        role: "operator",
        title: "Operator",
        summary: "For ABSL operators and the CEO: the ticket queue, dispatching, callbacks, reports, sign-ups and keeping the platform healthy — all in one place.",
        tasks: [
          {
            title: "Work the Ticket Queue",
            images: ["operator-queue"],
            steps: [
              "The **Ticket Queue** lists every ticket, with search and filters. **Waiting for a technician** in the summary cards counts open jobs nobody has yet.",
              "Press **Open** on a ticket to see it below the queue."
            ]
          },
          {
            title: "Assign or dispatch",
            images: ["operator-assign"],
            steps: [
              "To give a job to one person: under **Technician**, choose them and press **Assign**. They're emailed straight away.",
              "To let the first available technician take it: press **Release to all technicians** under **Dispatch**. Every technician sees it in Open Jobs."
            ]
          },
          {
            title: "Keep the customer informed",
            images: [],
            steps: [
              "Reply in the **Conversation** — the customer is emailed. Move the ticket along with the **Status** buttons; **Resolved** asks for the service call number, notes and receipt photo."
            ]
          },
          {
            title: "Callbacks and phone-ins",
            images: ["operator-callbacks"],
            steps: [
              "The **Callback Queue** lists customers waiting for a call. Press **Call** (on a phone), then **Done** once you've spoken.",
              "Use **Log a Job** for a customer who phoned instead of using the portal. Answer **Yes** to open it to every technician, or **No** to assign it later."
            ]
          },
          {
            title: "Reports",
            images: ["reports"],
            steps: [
              "Open **Reports** and choose a **Report Type** — Technician Wise, Customer Wise, Date Wise, All Faults, Service Call Number or All Jobs.",
              "Set its filters and press **Generate Report**.",
              "In the preview, sort any column by clicking its heading, filter each column, or search the whole report.",
              "**Download Excel** saves an Excel file, **Print Report** prints the report, and **Open Report** shows it full screen."
            ]
          },
          {
            title: "Service Plan and trips",
            images: ["service-plan","trip-planner-office"],
            steps: [
              "**Service Plan** shows every client site on a map (red overdue, blue pending, green done, grey nothing due) and the services due in a table.",
              "To load an updated service sheet: **Download template** (your sites as an Excel sheet), fill in Contract year, Status, Date done and Service call, then **Import from Excel**. You see what will change before anything is saved.",
              "**Mark sites due** adds a service for every site of a client for a contract year (for Seylan, 1st service and 2nd service). **Mark done** records a service done outside the helpdesk; **Skip** leaves a site out.",
              "**Add site** or **Edit** a site: its contact person and phone (shown to technicians on trips), device serial and exact map position (paste the numbers from Google Maps). Untick **Active** for sites ABSL no longer services.",
              "**Plan a trip** opens the **Trip Planner**. Choose a technician under **Give these stops to** and press **Assign the trip**: every stop becomes a job for them and they're emailed.",
              "Set the ABSL office's exact position once (the notice at the top of the page): every trip starts there."
            ]
          },
          {
            title: "Approve new accounts",
            images: ["operator-approvals"],
            steps: [
              "**User Approvals** lists new registrations waiting for review.",
              "Choose the role to grant — it starts on what they asked for — then press **Approve**, or **Reject**. They're emailed the decision.",
              "Operators can approve as Customer or Technician. Operator and CEO access is given by the CEO in the Main Console."
            ]
          },
          {
            title: "Company account limits",
            images: [],
            steps: [
              "When a company runs out of accounts, choose it under **Company Limit**, enter a new limit and press **Update Limit**."
            ]
          },
          {
            title: "Keep the platform healthy",
            images: [],
            steps: [
              "**Alerts** shows problems such as emails that could not be sent or storage filling up — press **Acknowledge** once each one is handled.",
              "**Notifications** is the email queue — **Retry** anything that failed.",
              "**Receipts** and **Client Errors** are records for checking jobs and diagnosing problems."
            ]
          }
        ]
      },
      {
        role: "main-console",
        title: "Main Console (CEO only)",
        summary: "For the CEO: who has which role, storage space and backups. Everything else the CEO does is in the Operator interface.",
        tasks: [
          {
            title: "Promote someone or change a role",
            images: ["main-console-staff"],
            steps: [
              "Open **Main Console** from the menu bar.",
              "Under **Manage Staff**, pick a new role for any account and press **Update Role** — make someone an Operator, a Technician or another CEO.",
              "Your own role can only be changed from a second CEO account."
            ]
          },
          {
            title: "Space and backups",
            images: ["main-console-backup"],
            steps: [
              "**Free plan space and backups** shows how much photo storage and database space is used. A System Alert warns at 80%.",
              "Everything is copied to the helpdesk Google Drive automatically every day (folder **ABSL Helpdesk**): receipts, job photos, monthly reports and a full backup.",
              "**Download backup** gives you an extra copy right now, to keep on a USB drive."
            ]
          },
          {
            title: "See a portal as its users do",
            images: [],
            steps: [
              "**Preview a portal** opens the Customer Portal or the Technician Field App. A yellow banner links you back to the Operator dashboard."
            ]
          }
        ]
      }
    ],
    tickets: {
      statuses: {
        new: "Just raised. Nobody has started on it yet.",
        in_progress: "A technician is working on it.",
        resolved: "The work is done. The technician has recorded the service call number and what was done.",
        closed: "Finished and filed away."
      },
      notes: [
        "**Priority** (High, Medium, Low) says how urgent a job is. **Job type** (Service, Fault, Installation, Other) says what kind of work it is.",
        "**In reports**, a New job that already has a technician shows as **Assigned**, and In Progress shows as **Ongoing**.",
        "**Who can move a ticket:** technicians can mark their jobs In Progress or Resolved; operators and the CEO can set any status; customers can close their own tickets."
      ]
    },
    emails: [
      "**Everyone:** a verification link when you register, a message when your account is approved (or not), and password reset links when you ask for one.",
      "**Customers:** ticket created, every status change, replies from ABSL, and the resolution with notes and the service call number.",
      "**Technicians:** when a job is assigned to you, and when a customer replies on one of your jobs.",
      "**Operators and the CEO:** when a customer replies on a ticket that has no technician yet."
    ],
    faq: [
      { q: "I didn't get the verification email.", a: "Wait a few minutes and check your spam or junk folder. Still nothing? Email us at the address below with the address you registered." },
      { q: "It says “Waiting for approval”.", a: "Your account needs ABSL to approve it. You'll get an email as soon as they do — then just sign in again." },
      { q: "I forgot my password.", a: "Press **Forgot password?** on the login page. The link we email you works once and expires after a short time." },
      { q: "It says “You do not have permission to do that”.", a: "That action isn't available to your role, or the ticket changed since you opened it (for example, another technician accepted the job). Reload the page and try again." },
      { q: "It says someone else updated this ticket.", a: "Two people changed it at the same moment. Reload to see their change, then make yours." },
      { q: "I can't find a ticket.", a: "Clear the search box and set the filters back to **All statuses** and **Any priority**, or press **See all** for the full list." },
      { q: "The badge at the top says Offline.", a: "You've lost your internet connection. Nothing you change is saved until it comes back." },
      { q: "My photo takes a long time to upload.", a: "Photos are made smaller on your phone before they're sent, so a slow connection is the usual reason. Wait for the success message before leaving the page." },
      { q: "Can I put the helpdesk on my phone's home screen?", a: "Yes. On Android (Chrome), open the **⋮** menu and choose **Add to Home screen** or **Install app**. On iPhone (Safari), tap **Share**, then **Add to Home Screen**." }
    ]
  },

  // -------------------------------------------------------------------
  si: {
    ui: {
      language: "භාෂාව",
      title: "පරිශීලක මාර්ගෝපදේශය",
      intro: "පළමු දිනයේ ඔබට අවශ්‍ය සියල්ල: ඇතුළු වීම, පද්ධතිය තුළ මඟ සොයා ගැනීම සහ වැඩක් නිම කිරීම — සෑම තිරයකම පින්තූර සමඟ.",
      toc: {
        start: "ආරම්භ කිරීම",
        navigation: "මඟ සොයා ගැනීම",
        roles: "ඔබේ භූමිකාවට මාර්ගෝපදේශය",
        tickets: "ටිකට්පතක් ඉදිරියට යන ආකාරය",
        emails: "ඔබට ලැබෙන ඊමේල්",
        faq: "නිතර අසන ප්‍රශ්න"
      },
      replayTour: "▶ පිළිගැනීමේ චාරිකාව නැවත බලන්න",
      rolesSignedIn: "ඔබේ භූමිකාව ඔබ වෙනුවෙන් විවෘත කර ඇත. වෙනත් එකක් කියවීමට එය තට්ටු කරන්න.",
      rolesSignedOut: "භාවිත කරන ආකාරය කියවීමට ඔබේ භූමිකාව තට්ටු කරන්න.",
      yourRole: "ඔබේ භූමිකාව",
      enlarge: "සම්පූර්ණ ප්‍රමාණයෙන් බැලීමට පින්තූරයක් තට්ටු කරන්න. පින්තූරවල ඇත්තේ උදාහරණ දත්ත පමණි.",
      navNote: "සෑම පෝටලයකටම වෙනම වර්ණයක් ඇති නිසා, ඔබ සිටින්නේ කුමන එකේද යන්න එක බැල්මෙන් හඳුනාගත හැකිය.",
      startNote: "ලියාපදිංචි වන විට Operator හෝ CEO ගිණුම් ඉල්ලිය නොහැක. සාමාන්‍ය පරිදි ලියාපදිංචි වන්න; CEO ඔබේ භූමිකාව සකසනු ඇත.",
      emailsNote: "ඊමේල් පැමිණෙන්නේ ABSL Helpdesk වෙතිනි. එකක් නොපෙනේ නම්, spam හෝ junk ෆෝල්ඩරය පරීක්ෂා කරන්න.",
      contact: "තවමත් ගැටලුවක්ද? {email} වෙත ඊමේල් කරන්න — වැඩක් ගැන නම් ටිකට් අංකයද සඳහන් කරන්න.",
      goDashboard: "මගේ dashboard එකට යන්න",
      createAccount: "ගිණුමක් සාදන්න",
      login: "ඇතුළු වන්න"
    },
    start: {
      intro: "ABSL Helpdesk යනු Automated Barcode Solutions පාරිභෝගිකයින් තම barcode, මුද්‍රණ සහ scanning උපකරණවල ගැටලු වාර්තා කරන, සහ ABSL කාර්ය මණ්ඩලය සෑම වැඩක්ම පළමු වාර්තාවේ සිට විසඳුම දක්වා කරගෙන යන ස්ථානයයි.",
      images: ["register", "login"],
      steps: [
        "**ගිණුමක් සාදන්න.** **Register** විවෘත කර **Customer** තෝරන්න (ඔබ ABSL හි සේවය කරන්නේ නම් **Technician / Field Staff**). ඉන්පසු ඔබේ සම්පූර්ණ නම, සමාගම, ඊමේල්, දුරකථන අංකය සහ මුරපදයක් ඇතුළත් කරන්න. ටයිප් කළ දේ පරීක්ෂා කිරීමට **Show** ඔබා, ඉන්පසු **Create Account** ඔබන්න.",
        "**ඊමේල් තහවුරු කරන්න.** අප එවන ඊමේල් එක විවෘත කර link එක ක්ලික් කරන්න — එසේ කරන තුරු ඇතුළු විය නොහැක.",
        "**අවශ්‍ය නම්, අනුමැතිය සඳහා රැඳී සිටින්න.** ABSL තහවුරු කළ ඊමේල් domain එකක ගිණුම් වහාම අනුමත වේ. පුද්ගලික ඊමේල් ලිපින සහ සියලුම field-staff ඉල්ලීම් පළමුව ABSL විසින් පරීක්ෂා කරයි; එය අවසන් වූ විට ඔබට ඊමේල් එකක් ලැබේ.",
        "**ඇතුළු වන්න.** **Login** විවෘත කර ඔබේ ඊමේල් සහ මුරපදය ඇතුළත් කරන්න. ඔබ ස්වයංක්‍රීයව ඔබේම dashboard එකට යයි. මුරපදය අමතකද? **Forgot password?** ඔබන්න.",
        "**පළමු වතාවටද?** කෙටි පිළිගැනීමේ චාරිකාවක් ඔබට සියල්ල පෙන්වයි. එය ඕනෑම වේලාවක මෙම පිටුවෙන් නැවත බැලිය හැක."
      ]
    },
    navigation: {
      image: "office-menu",
      items: [
        { title: "ඉහළ තීරුව", body: "ඉහළින්ම ඇති තද පැහැති තීරුව: ඔබේ සම්බන්ධතා තත්ත්වය (**Connected** හෝ **Offline**), **Help** (මෙම මාර්ගෝපදේශය) සහ **Sign Out**." },
        { title: "මෙනු තීරුව", body: "එයට පහළින්. පාරිභෝගිකයින්ට ඔවුන්ගේ පෝටලය පෙනේ; technicians ලාට ඔවුන්ගේ පෝටලය, **My Job Reports** සහ **Trip Planner**. Operators ලාට **Dashboard**, **Reports**, **Approvals**, **Alerts**, **Notifications**, **Receipts**, **Client Errors** සහ **Service Plan** පෙනේ — CEO ට **Main Console** ද පෙනේ." },
        { title: "පිටු ශීර්ෂය", body: "ඔබේ පෝටලයේ නම සහ එහි කාර්යය, දකුණු පසින් ඔබේ භූමිකාව සහ නම — ඒ නිසා ඔබ ඇතුළු වී සිටින්නේ කුමන ගිණුමෙන්දැයි සැමවිට දැනගත හැක." },
        { title: "සාරාංශ කාඩ්පත්", body: "ඔබේ dashboard එකේ ඉහළින් ඇති අංක: විවෘත ටිකට්පත්, technician කෙනෙකු බලාපොරොත්තුවෙන් සිටින වැඩ, නොකියවූ alerts ආදිය." },
        { title: "ලැයිස්තු සහ සෙවීම", body: "සෑම ටිකට් ලැයිස්තුවකම සෙවුම් කොටුවක් සහ status / priority filters ඇත. **See all** මඟින් සම්පූර්ණ ලැයිස්තුව විවෘත වේ." },
        { title: "ටිකට්පතේ විස්තර", body: "ඕනෑම ටිකට්පතක **Open** ඔබන්න; එහි සම්පූර්ණ විස්තර **ලැයිස්තුවලට පහළින්** විවෘත වේ — පහළට scroll කරන්න. Status බොත්තම්, assign කිරීම, ඡායාරූප, පිළිතුරු සහ ඉතිහාසය සියල්ල එහි ඇත." }
      ]
    },
    roles: [
      {
        role: "customer",
        title: "පාරිභෝගික පෝටලය (Customer Portal)",
        summary: "ගැටලුවක් වාර්තා කර එය විසඳන තුරු අනුගමනය කරන පාරිභෝගිකයින් සඳහා.",
        tasks: [
          {
            title: "ටිකට්පතක් සාදන්න",
            images: ["customer-new-ticket"],
            steps: [
              "**Create New Ticket** හි **Job Type** තෝරන්න: Service, Fault, Installation හෝ Other.",
              "ගැටලුව ඇති **Department** එක එක් කරන්න — එය සොයා ගැනීමට උදව් වේ නම් (අත්‍යවශ්‍ය නැත).",
              "කෙටි **Problem Summary** එකක් ලියන්න, අදාළ **Common Problems** tick කරන්න, වෙනත් විස්තර එක් කරන්න.",
              "**Priority** සහ ස්ථානයේ **Location** සකසන්න. දුරකථනයක නම්, **Use my location** මඟින් ඔබේ GPS ස්ථානය පුරවයි.",
              "වෙනත් අයෙකු technician හමුවන්නේ නම්, ඔවුන්ගේ **Site contact number** එක් කරන්න.",
              "කෙනෙකු සමඟ කතා කිරීමට කැමති නම් **Need phone callback?** tick කර, **Submit Ticket** ඔබන්න."
            ]
          },
          {
            title: "ඔබේ ටිකට්පත් අනුගමනය කරන්න",
            images: ["customer-my-tickets"],
            steps: [
              "ඔබ සාදන සෑම ටිකට්පතක්ම එහි වත්මන් තත්ත්වය සමඟ **My Tickets** හි ලැයිස්තුගත වේ.",
              "ටිකට්පතක **Open** ඔබා ලැයිස්තුවලට පහළින් සම්පූර්ණ විස්තර බලන්න: විස්තර, ඡායාරූප, technician, සංවාදය සහ ඉතිහාසය.",
              "පැරණි ටිකට්පතක් සොයා ගැනීමට සෙවුම් කොටුව සහ filters භාවිත කරන්න."
            ]
          },
          {
            title: "ABSL සමඟ කතා කරන්න",
            images: ["customer-conversation"],
            steps: [
              "ටිකට්පතේ පහළ ඇති **Conversation** කොටුවේ ලියා **Send** ඔබන්න. ABSL පිළිතුරු දෙන සෑම විටම අපි ඔබට ඊමේල් කරන්නෙමු.",
              "දුරකථන ඇමතුමකට කැමතිද? ටිකට්පතේ **Prefer a phone call?** භාවිත කර ඔබේ අංකය ඇතුළත් කරන්න."
            ]
          },
          {
            title: "ටිකට්පතක් වෙනස් කිරීම හෝ වසා දැමීම",
            images: ["customer-close"],
            steps: [
              "ටිකට්පත තවමත් **New** නම්, එය නිවැරදි කිරීමට **Edit ticket details** විවෘත කරන්න.",
              "වැඩය අවසන් වූ විට විසඳුම් සටහන් සහ service call අංකය සමඟ ඊමේල් එකක් ලැබේ. ඔබ සෑහීමකට පත් වූ පසු **Closed** ඔබන්න."
            ]
          }
        ]
      },
      {
        role: "technician",
        title: "තාක්ෂණික නිලධාරී යෙදුම (Technician Field App)",
        summary: "ABSL ක්ෂේත්‍ර technicians ලා සඳහා: ඔබේ වැඩ, විවෘත වැඩ සංචිතය සහ ඔබේම වැඩ ලියාපදිංචි කිරීම.",
        tasks: [
          {
            title: "ඔබේ වැඩ ගණන්",
            images: ["tech-counts"],
            steps: [
              "ඉහළ කාඩ්පත් ඔබේ වැඩ ගණන් කරයි: **New** (ඔබට ලැබුණු, තවම විවෘත නොකළ), **Assigned** (විවෘත කළ, ආරම්භ නොකළ), **Ongoing** (In Progress) සහ **Resolved** (විසඳූ හෝ වසා දැමූ).",
              "එම වැඩ පමණක් My Job Reports හි බැලීමට කාඩ්පතක් තට්ටු කරන්න."
            ]
          },
          {
            title: "Open Jobs වෙතින් වැඩක් ගන්න",
            images: ["tech-open-jobs"],
            steps: [
              "වැඩක් සියලු technicians ලාට විවෘත කළ විට, ඔබේ පිටුවේ ඉහළින් **Open Jobs** දිස් වේ.",
              "වැඩයේ **Open** ඔබා, **Technician → Assign or hand over** යටතේ ඔබේ නම තෝරා **Assign** ඔබන්න. පළමුව භාර ගන්නා technician ට වැඩය ලැබේ."
            ]
          },
          {
            title: "ඔබේ වැඩ කරන්න",
            images: ["tech-status", "tech-photos"],
            steps: [
              "**My Jobs** හි ඔබට පවරා ඇති සියලු වැඩ ලැයිස්තුගත වේ. එකක **Open** ඔබන්න.",
              "වැඩය ආරම්භ කරන විට **In Progress** ඔබන්න. ඇමතීමට site contact අංකය තට්ටු කරන්න, හෝ ස්ථානය සොයා ගැනීමට **Open map** ඔබන්න.",
              "වැඩ කරන අතරතුර **Add photo** මඟින් ඡායාරූප එක් කර, **Conversation** හි පාරිභෝගිකයාට තොරතුරු දන්වන්න."
            ]
          },
          {
            title: "වැඩක් විසඳන්න (Resolve)",
            images: ["tech-resolve"],
            steps: [
              "**Resolved** ඔබන්න. **Service call number**, ඔබේ **Resolution notes** සහ **Receipt photo** ඇතුළත් කරන්න — තුනම අනිවාර්යයි.",
              "**Resolve** ඔබන්න. ඔබේ සටහන් සහ service call අංකය පාරිභෝගිකයාට ඊමේල් කෙරෙන අතර රිසිට්පත ගොනු වේ."
            ]
          },
          {
            title: "වැඩක් සගයෙකුට භාර දෙන්න",
            images: ["tech-handover"],
            steps: [
              "වැඩය විවෘත කර, **Assign or hand over** යටතේ සගයා තෝරා, හේතුවක් එක් කර **Reassign** ඔබන්න. භාර දීමේ සටහන සංවාදයේ දිස් වේ."
            ]
          },
          {
            title: "වැඩක් ලියාපදිංචි කරන්න (Log a Job)",
            images: ["tech-my-jobs", "tech-log-job"],
            steps: [
              "පෝටලය හරහා නොආ වැඩ සඳහා **Log a Job** ඔබන්න.",
              "පාරිභෝගිකයෙකු ඔබට කතා කළා නම්: සමාගම, අමතන්නාගේ නම සහ දුරකථන අංකය, job type, **Fault location** සහ ගැටලුව ඇතුළත් කරන්න.",
              "කිසිවෙකු නොඇමතූ, ඔබම කළ යුතු වැඩක් නම්: **This is my own job** tick කරන්න — එය වහාම ඔබට පැවරේ.",
              "පහළ ප්‍රශ්නයට පිළිතුරු දෙන්න: **Yes** නම් සියලු technicians ලාට විවෘත වේ (Open Jobs වෙත යයි); **No** නම් ඔබට පැවරේ. ඉන්පසු **Log Job** ඔබන්න."
            ]
          },
          {
            title: "ගමනක් සැලසුම් කරන්න (Trip Planner)",
            images: ["trip-planner-phone"],
            steps: [
              "දුර ගමනක් යනවාද? මෙනු තීරුවෙන් **Trip Planner** විවෘත කරන්න, නැතහොත් විවෘත වැඩයක **Plan a trip** ඔබන්න.",
              "**Going to** යටතේ ඔබ යන තැන තෝරන්න: වැඩයක්, නගරයක්, හෝ ඔබ අවට ඇති පාරිභෝගික ස්ථාන. මඟ දිගේ ඇති pending සේවා tick කර ඇත; **Other client sites on the way** (කිසිවක් due නැති ස්ථාන) ද tick කළ හැක.",
              "දිගු ගමන් දින වලට බෙදා ඇත (**Driving day** සහ **Time at each stop** සකසන්න). සෑම දිනකටම වෙනම Google Maps link එකක් ඇත; එක් දින ගමනකට **Open route in Google Maps** ඇත.",
              "**Share trip** මඟින් නැවතුම් සහ links WhatsApp වෙත යවයි; **Print trip sheet** මඟින් service call අංක ලිවීමට ඉඩ සහිතව මුද්‍රණය කරයි.",
              "සෑම නැවතුමකදීම **Start service** ඔබන්න (කිසිවක් due නැති තැනක **Start visit**): එය ඔබේ වැඩයක් වේ. **In Progress** කර, ඉන්පසු service call අංකය සහ රිසිට් ඡායාරූපය සමඟ **Resolved** කරන්න; එවිට සේවාව සම්පූර්ණ ලෙස සටහන් වේ."
            ]
          },
          {
            title: "My Job Reports",
            images: ["my-reports-filters", "my-reports-table"],
            steps: [
              "මෙනු තීරුවෙන් **My Job Reports** විවෘත කරන්න. ඔබට පවරා ඇති සියලු වැඩ — ඔබේ ඒවා පමණක් — එහි ඇත.",
              "**Job Status**, **Job Type**, **From Date** / **To Date**, **Service Call No** හෝ **Customer Name** අනුව (ඕනෑම සංයෝජනයකින්) පෙරා, **Generate Report** ඔබන්න. නැවත ආරම්භ කිරීමට **Reset Filters**.",
              "වගුවේ, ඕනෑම තීරුවක් එහි ශීර්ෂයෙන් පිළිවෙළට සකසන්න, ශීර්ෂ යටින් ඇති පේළියෙන් එක් එක් තීරුව පෙරන්න, නැතහොත් සම්පූර්ණ වාර්තාවම සොයන්න.",
              "**Download Excel** මඟින් Excel ගොනුවක් සුරකින අතර **Print Report** මඟින් වාර්තාව පමණක් මුද්‍රණය කරයි."
            ]
          }
        ]
      },
      {
        role: "operator",
        title: "Operator",
        summary: "ABSL operators සහ CEO සඳහා: ටිකට් පෝලිම, වැඩ බෙදා දීම, callbacks, වාර්තා, නව ගිණුම් සහ පද්ධතිය නිරෝගීව තබා ගැනීම — සියල්ල එක තැනක.",
        tasks: [
          {
            title: "Ticket Queue එක සමඟ වැඩ කරන්න",
            images: ["operator-queue"],
            steps: [
              "**Ticket Queue** හි සෙවීම සහ filters සමඟ සියලු ටිකට්පත් ඇත. සාරාංශ කාඩ්පත්වල **Waiting for a technician** මඟින් තවම කිසිවෙකුට නොලැබුණු වැඩ ගණන් කරයි.",
              "ටිකට්පතක **Open** ඔබා එය පෝලිමට පහළින් බලන්න."
            ]
          },
          {
            title: "Assign කිරීම හෝ බෙදා හැරීම",
            images: ["operator-assign"],
            steps: [
              "එක් අයෙකුට වැඩක් දීමට: **Technician** යටතේ ඔවුන් තෝරා **Assign** ඔබන්න. ඔවුන්ට වහාම ඊමේල් කෙරේ.",
              "පළමුව සිටින ඕනෑම technician කෙනෙකුට ගැනීමට ඉඩ දීමට: **Dispatch** යටතේ **Release to all technicians** ඔබන්න. සියලු technicians ලාට එය Open Jobs හි පෙනේ."
            ]
          },
          {
            title: "පාරිභෝගිකයාට තොරතුරු දන්වන්න",
            images: [],
            steps: [
              "**Conversation** හි පිළිතුරු දෙන්න — පාරිභෝගිකයාට ඊමේල් කෙරේ. **Status** බොත්තම් මඟින් ටිකට්පත ඉදිරියට ගෙන යන්න; **Resolved** සඳහා service call අංකය, සටහන් සහ රිසිට් ඡායාරූපය අවශ්‍ය වේ."
            ]
          },
          {
            title: "Callbacks සහ දුරකථන ඇමතුම්",
            images: ["operator-callbacks"],
            steps: [
              "**Callback Queue** හි ඇමතුමක් බලාපොරොත්තුවෙන් සිටින පාරිභෝගිකයින් ඇත. **Call** ඔබා (දුරකථනයක), කතා කළ පසු **Done** ඔබන්න.",
              "පෝටලය වෙනුවට දුරකථනයෙන් කතා කළ පාරිභෝගිකයෙකු සඳහා **Log a Job** භාවිත කරන්න. සියලු technicians ලාට විවෘත කිරීමට **Yes**, පසුව assign කිරීමට **No**."
            ]
          },
          {
            title: "වාර්තා (Reports)",
            images: ["reports"],
            steps: [
              "**Reports** විවෘත කර **Report Type** එකක් තෝරන්න — Technician Wise, Customer Wise, Date Wise, All Faults, Service Call Number හෝ All Jobs.",
              "එහි filters සකසා **Generate Report** ඔබන්න.",
              "පෙරදසුනේ, ශීර්ෂය ක්ලික් කර ඕනෑම තීරුවක් පිළිවෙළට සකසන්න, එක් එක් තීරුව පෙරන්න, නැතහොත් සම්පූර්ණ වාර්තාවම සොයන්න.",
              "**Download Excel** මඟින් Excel ගොනුවක් සුරකියි, **Print Report** මඟින් මුද්‍රණය කරයි, **Open Report** මඟින් සම්පූර්ණ තිරයෙන් පෙන්වයි."
            ]
          },
          {
            title: "Service Plan සහ ගමන්",
            images: ["service-plan","trip-planner-office"],
            steps: [
              "**Service Plan** හි සෑම පාරිභෝගික ස්ථානයක්ම සිතියමක (රතු overdue, නිල් pending, කොළ done, අළු කිසිවක් due නැත) සහ due සේවා වගුවක පෙන්වයි.",
              "යාවත්කාලීන සේවා sheet එකක් දැමීමට: **Download template** (ඔබේ ස්ථාන Excel sheet එකක් ලෙස) ලබා ගෙන Contract year, Status, Date done සහ Service call පුරවා, **Import from Excel** කරන්න. කිසිවක් සුරැකීමට පෙර වෙනස් වන දේ ඔබට පෙනේ.",
              "**Mark sites due** මඟින් කොන්ත්‍රාත් වර්ෂයක් සඳහා පාරිභෝගිකයෙකුගේ සෑම ස්ථානයකටම සේවාවක් එක් කරයි (Seylan සඳහා 1st service සහ 2nd service). **Mark done** මඟින් helpdesk එකෙන් පිටත කළ සේවාවක් සටහන් කරයි; **Skip** මඟින් ස්ථානයක් ඉවත් කරයි.",
              "**Add site** හෝ **Edit**: ස්ථානයේ සම්බන්ධ විය යුතු පුද්ගලයා සහ දුරකථනය (ගමන් වලදී technicians ලාට පෙන්වයි), device serial, සහ නිවැරදි සිතියම් ස්ථානය (Google Maps හි අංක paste කරන්න). ABSL තවදුරටත් සේවා නොකරන ස්ථාන සඳහා **Active** untick කරන්න.",
              "**Plan a trip** මඟින් **Trip Planner** විවෘත කරයි. **Give these stops to** යටතේ technician කෙනෙකු තෝරා **Assign the trip** ඔබන්න: සෑම නැවතුමක්ම ඔවුන්ට වැඩයක් වන අතර ඔවුන්ට ඊමේල් කෙරේ.",
              "ABSL කාර්යාලයේ නිවැරදි ස්ථානය එක් වරක් සකසන්න (පිටුවේ ඉහළ ඇති notice එක): සෑම ගමනක්ම එතැනින් ආරම්භ වේ."
            ]
          },
          {
            title: "නව ගිණුම් අනුමත කරන්න",
            images: ["operator-approvals"],
            steps: [
              "**User Approvals** හි සමාලෝචනය බලාපොරොත්තුවෙන් සිටින නව ලියාපදිංචි කිරීම් ඇත.",
              "ලබා දිය යුතු භූමිකාව තෝරන්න — එය ඔවුන් ඉල්ලූ එකෙන් ආරම්භ වේ — ඉන්පසු **Approve** හෝ **Reject** ඔබන්න. තීරණය ඔවුන්ට ඊමේල් කෙරේ.",
              "Operators ලාට Customer හෝ Technician ලෙස අනුමත කළ හැක. Operator සහ CEO ප්‍රවේශය ලබා දෙන්නේ CEO විසින් Main Console හරහාය."
            ]
          },
          {
            title: "සමාගම් ගිණුම් සීමා",
            images: [],
            steps: [
              "සමාගමකට ගිණුම් අවසන් වූ විට, **Company Limit** යටතේ එය තෝරා, නව සීමාවක් ඇතුළත් කර **Update Limit** ඔබන්න."
            ]
          },
          {
            title: "පද්ධතිය නිරෝගීව තබා ගන්න",
            images: [],
            steps: [
              "**Alerts** මඟින් යැවිය නොහැකි වූ ඊමේල් හෝ ගබඩා ඉඩ පිරීම වැනි ගැටලු පෙන්වයි — එක් එක් එක විසඳූ පසු **Acknowledge** ඔබන්න.",
              "**Notifications** යනු ඊමේල් පෝලිමයි — අසාර්ථක වූ ඕනෑම එකක් **Retry** කරන්න.",
              "**Receipts** සහ **Client Errors** යනු වැඩ පරීක්ෂා කිරීමට සහ ගැටලු හඳුනා ගැනීමට ඇති වාර්තා වේ."
            ]
          }
        ]
      },
      {
        role: "main-console",
        title: "Main Console (CEO පමණි)",
        summary: "CEO සඳහා: කාට කුමන භූමිකාවද, ගබඩා ඉඩ සහ backups. CEO කරන අනෙක් සියල්ල Operator අතුරුමුහුණතේ ඇත.",
        tasks: [
          {
            title: "කෙනෙකු උසස් කිරීම හෝ භූමිකාව වෙනස් කිරීම",
            images: ["main-console-staff"],
            steps: [
              "මෙනු තීරුවෙන් **Main Console** විවෘත කරන්න.",
              "**Manage Staff** යටතේ, ඕනෑම ගිණුමකට නව භූමිකාවක් තෝරා **Update Role** ඔබන්න — කෙනෙකු Operator, Technician හෝ තවත් CEO කෙනෙකු කරන්න.",
              "ඔබේම භූමිකාව වෙනස් කළ හැක්කේ දෙවන CEO ගිණුමකින් පමණි."
            ]
          },
          {
            title: "ගබඩා ඉඩ සහ backups",
            images: ["main-console-backup"],
            steps: [
              "**Free plan space and backups** මඟින් ඡායාරූප ගබඩාව සහ database ඉඩ කොපමණ භාවිත වී ඇත්දැයි පෙන්වයි. 80% දී System Alert එකක් අනතුරු අඟවයි.",
              "සියල්ල දිනපතා ස්වයංක්‍රීයව helpdesk Google Drive වෙත පිටපත් වේ (**ABSL Helpdesk** ෆෝල්ඩරය): රිසිට්පත්, වැඩ ඡායාරූප, මාසික වාර්තා සහ සම්පූර්ණ backup එකක්.",
              "**Download backup** මඟින් USB drive එකක තබා ගැනීමට අමතර පිටපතක් දැන්ම ලබා දෙයි."
            ]
          },
          {
            title: "පරිශීලකයින් දකින ආකාරයටම පෝටලයක් බලන්න",
            images: [],
            steps: [
              "**Preview a portal** මඟින් Customer Portal හෝ Technician Field App විවෘත කරයි. කහ පැහැති තීරුවක් ඔබව නැවත Operator dashboard වෙත ගෙන යයි."
            ]
          }
        ]
      }
    ],
    tickets: {
      statuses: {
        new: "අලුතින් සාදන ලදී. තවම කිසිවෙකු වැඩ ආරම්භ කර නැත.",
        in_progress: "Technician කෙනෙකු එහි වැඩ කරමින් සිටී.",
        resolved: "වැඩය අවසන්. Technician විසින් service call අංකය සහ කළ දේ සටහන් කර ඇත.",
        closed: "අවසන් කර ගොනු කර ඇත."
      },
      notes: [
        "**Priority** (High, Medium, Low) මඟින් වැඩයක හදිසි බව කියයි. **Job type** (Service, Fault, Installation, Other) මඟින් එය කුමන ආකාරයේ වැඩක්දැයි කියයි.",
        "**වාර්තාවල**, දැනටමත් technician කෙනෙකු සිටින New වැඩයක් **Assigned** ලෙසත්, In Progress **Ongoing** ලෙසත් පෙන්වයි.",
        "**ටිකට්පතක් ඉදිරියට ගෙන යා හැක්කේ කාටද:** technicians ලාට ඔවුන්ගේ වැඩ In Progress හෝ Resolved කළ හැක; operators සහ CEO ට ඕනෑම තත්ත්වයක් සැකසිය හැක; පාරිභෝගිකයින්ට ඔවුන්ගේම ටිකට්පත් වසා දැමිය හැක."
      ]
    },
    emails: [
      "**සියලු දෙනාට:** ලියාපදිංචි වන විට තහවුරු කිරීමේ link එකක්, ගිණුම අනුමත වූ විට (හෝ නොවූ විට) පණිවිඩයක්, සහ ඉල්ලූ විට මුරපදය යළි සැකසීමේ links.",
        "**පාරිභෝගිකයින්ට:** ටිකට්පත සෑදූ විට, සෑම තත්ත්ව වෙනසකදීම, ABSL පිළිතුරු දුන් විට, සහ සටහන් හා service call අංකය සමඟ විසඳුම.",
      "**Technicians ලාට:** වැඩක් ඔබට පැවරූ විට, සහ ඔබේ වැඩයක පාරිභෝගිකයෙකු පිළිතුරු දුන් විට.",
      "**Operators සහ CEO ට:** තවම technician කෙනෙකු නැති ටිකට්පතක පාරිභෝගිකයෙකු පිළිතුරු දුන් විට."
    ],
    faq: [
      { q: "මට තහවුරු කිරීමේ ඊමේල් එක ලැබුණේ නැත.", a: "මිනිත්තු කිහිපයක් රැඳී සිට spam හෝ junk ෆෝල්ඩරය පරීක්ෂා කරන්න. තවමත් නැත්නම්, ඔබ ලියාපදිංචි වූ ඊමේල් ලිපිනය සමඟ පහත ලිපිනයට අපට ඊමේල් කරන්න." },
      { q: "“Waiting for approval” ලෙස පෙන්වයි.", a: "ඔබේ ගිණුම ABSL විසින් අනුමත කළ යුතුය. ඔවුන් අනුමත කළ වහාම ඔබට ඊමේල් එකක් ලැබේ — ඉන්පසු නැවත ඇතුළු වන්න." },
      { q: "මට මුරපදය අමතක විය.", a: "Login පිටුවේ **Forgot password?** ඔබන්න. අප එවන link එක එක් වරක් පමණක් ක්‍රියා කරන අතර කෙටි කාලයකින් කල් ඉකුත් වේ." },
      { q: "“You do not have permission to do that” ලෙස පෙන්වයි.", a: "එම ක්‍රියාව ඔබේ භූමිකාවට නොමැත, නැතහොත් ඔබ විවෘත කළ පසු ටිකට්පත වෙනස් වී ඇත (උදා: වෙනත් technician කෙනෙකු වැඩය භාර ගත්තා). පිටුව reload කර නැවත උත්සාහ කරන්න." },
      { q: "වෙනත් අයෙකු මෙම ටිකට්පත යාවත්කාලීන කළ බව පෙන්වයි.", a: "දෙදෙනෙකු එකම මොහොතේ එය වෙනස් කළා. ඔවුන්ගේ වෙනස බැලීමට reload කර, ඉන්පසු ඔබේ වෙනස කරන්න." },
      { q: "මට ටිකට්පතක් සොයා ගත නොහැක.", a: "සෙවුම් කොටුව හිස් කර filters නැවත **All statuses** සහ **Any priority** ලෙස සකසන්න, නැතහොත් සම්පූර්ණ ලැයිස්තුව සඳහා **See all** ඔබන්න." },
      { q: "ඉහළ ලේබලය Offline ලෙස පෙන්වයි.", a: "ඔබේ අන්තර්ජාල සම්බන්ධතාවය නැති වී ඇත. එය නැවත පැමිණෙන තුරු ඔබ කරන කිසිදු වෙනසක් සුරැකෙන්නේ නැත." },
      { q: "මගේ ඡායාරූපය upload වීමට වැඩි කාලයක් ගනී.", a: "ඡායාරූප යැවීමට පෙර ඔබේ දුරකථනයේදීම කුඩා කරන නිසා, සාමාන්‍යයෙන් හේතුව මන්දගාමී සම්බන්ධතාවයකි. පිටුවෙන් ඉවත් වීමට පෙර සාර්ථක පණිවිඩය එන තුරු රැඳී සිටින්න." },
      { q: "Helpdesk එක මගේ දුරකථනයේ home screen එකට දැමිය හැකිද?", a: "ඔව්. Android (Chrome) හි **⋮** මෙනුව විවෘත කර **Add to Home screen** හෝ **Install app** තෝරන්න. iPhone (Safari) හි **Share** තට්ටු කර, ඉන්පසු **Add to Home Screen** තෝරන්න." }
    ]
  },

  // -------------------------------------------------------------------
  ta: {
    ui: {
      language: "மொழி",
      title: "பயனர் வழிகாட்டி",
      intro: "முதல் நாளுக்குத் தேவையான அனைத்தும்: உள்நுழைவது, அமைப்பில் வழி கண்டுபிடிப்பது, ஒரு வேலையை முடிப்பது — ஒவ்வொரு திரையின் படங்களுடன்.",
      toc: {
        start: "தொடங்குதல்",
        navigation: "வழி கண்டுபிடித்தல்",
        roles: "உங்கள் பங்குக்கான வழிகாட்டி",
        tickets: "டிக்கெட் எவ்வாறு முன்னேறுகிறது",
        emails: "உங்களுக்கு வரும் மின்னஞ்சல்கள்",
        faq: "அடிக்கடி கேட்கப்படும் கேள்விகள்"
      },
      replayTour: "▶ வரவேற்பு சுற்றுலாவை மீண்டும் பார்க்க",
      rolesSignedIn: "உங்கள் பங்கு உங்களுக்காகத் திறக்கப்பட்டுள்ளது. மற்றொன்றைப் படிக்க அதைத் தட்டவும்.",
      rolesSignedOut: "பயன்படுத்தும் முறையைப் படிக்க உங்கள் பங்கைத் தட்டவும்.",
      yourRole: "உங்கள் பங்கு",
      enlarge: "முழு அளவில் பார்க்க படத்தைத் தட்டவும். படங்களில் உள்ளவை மாதிரித் தரவுகள் மட்டுமே.",
      navNote: "ஒவ்வொரு போர்ட்டலுக்கும் தனி நிறம் உள்ளதால், நீங்கள் எதில் இருக்கிறீர்கள் என்பதை ஒரே பார்வையில் அறியலாம்.",
      startNote: "பதிவு செய்யும்போது Operator அல்லது CEO கணக்குகளைக் கோர முடியாது. வழக்கம்போல் பதிவு செய்யுங்கள்; CEO உங்கள் பங்கை அமைப்பார்.",
      emailsNote: "மின்னஞ்சல்கள் ABSL Helpdesk இலிருந்து வரும். ஒன்றைக் காணவில்லை என்றால், spam அல்லது junk கோப்புறையைப் பாருங்கள்.",
      contact: "இன்னும் சிக்கலா? {email} க்கு மின்னஞ்சல் அனுப்புங்கள் — ஒரு வேலை பற்றியது என்றால் டிக்கெட் எண்ணையும் குறிப்பிடுங்கள்.",
      goDashboard: "என் dashboard க்குச் செல்ல",
      createAccount: "கணக்கை உருவாக்க",
      login: "உள்நுழைய"
    },
    start: {
      intro: "ABSL Helpdesk என்பது Automated Barcode Solutions வாடிக்கையாளர்கள் தங்கள் barcode, அச்சு மற்றும் scanning உபகரணங்களின் பிரச்சினைகளைப் புகாரளிக்கும், ABSL ஊழியர்கள் ஒவ்வொரு வேலையையும் முதல் புகாரிலிருந்து தீர்வு வரை கொண்டு செல்லும் இடமாகும்.",
      images: ["register", "login"],
      steps: [
        "**கணக்கை உருவாக்குங்கள்.** **Register** ஐத் திறந்து **Customer** ஐத் தேர்ந்தெடுங்கள் (நீங்கள் ABSL இல் பணிபுரிந்தால் **Technician / Field Staff**). பின்னர் உங்கள் முழுப் பெயர், நிறுவனம், மின்னஞ்சல், தொலைபேசி எண் மற்றும் கடவுச்சொல்லை உள்ளிடுங்கள். தட்டச்சு செய்ததைச் சரிபார்க்க **Show** அழுத்தி, பின்னர் **Create Account** அழுத்துங்கள்.",
        "**மின்னஞ்சலை உறுதிப்படுத்துங்கள்.** நாங்கள் அனுப்பும் மின்னஞ்சலைத் திறந்து இணைப்பைக் கிளிக் செய்யுங்கள் — அதுவரை உள்நுழைய முடியாது.",
        "**தேவைப்பட்டால், ஒப்புதலுக்காகக் காத்திருங்கள்.** ABSL சரிபார்த்த மின்னஞ்சல் domain கணக்குகள் உடனே ஒப்புதல் பெறும். தனிப்பட்ட மின்னஞ்சல் முகவரிகளும் அனைத்து field-staff கோரிக்கைகளும் முதலில் ABSL ஆல் சரிபார்க்கப்படும்; முடிந்ததும் உங்களுக்கு மின்னஞ்சல் வரும்.",
        "**உள்நுழையுங்கள்.** **Login** ஐத் திறந்து உங்கள் மின்னஞ்சல் மற்றும் கடவுச்சொல்லை உள்ளிடுங்கள். நீங்கள் தானாகவே உங்கள் dashboard க்குச் செல்வீர்கள். கடவுச்சொல் மறந்துவிட்டதா? **Forgot password?** அழுத்துங்கள்.",
        "**முதல் முறையா?** ஒரு சிறிய வரவேற்பு சுற்றுலா உங்களுக்கு எல்லாவற்றையும் காட்டும். அதை எப்போது வேண்டுமானாலும் இந்தப் பக்கத்திலிருந்து மீண்டும் பார்க்கலாம்."
      ]
    },
    navigation: {
      image: "office-menu",
      items: [
        { title: "மேல் பட்டை", body: "மிக மேலே உள்ள கருமையான பட்டை: உங்கள் இணைப்பு நிலை (**Connected** அல்லது **Offline**), **Help** (இந்த வழிகாட்டி) மற்றும் **Sign Out**." },
        { title: "மெனு பட்டை", body: "அதன் கீழே. வாடிக்கையாளர்கள் தங்கள் போர்ட்டலைப் பார்ப்பார்கள்; technicians தங்களுடையதையும் **My Job Reports**, **Trip Planner** ஐயும். Operators **Dashboard**, **Reports**, **Approvals**, **Alerts**, **Notifications**, **Receipts**, **Client Errors** மற்றும் **Service Plan** ஐப் பார்ப்பார்கள் — CEO **Main Console** ஐயும் பார்ப்பார்." },
        { title: "பக்கத் தலைப்பு", body: "உங்கள் போர்ட்டலின் பெயரும் அதன் நோக்கமும், வலப்புறம் உங்கள் பங்கும் பெயரும் — எனவே எந்தக் கணக்கில் உள்நுழைந்துள்ளீர்கள் என்பது எப்போதும் தெரியும்." },
        { title: "சுருக்க அட்டைகள்", body: "உங்கள் dashboard இன் மேலே உள்ள எண்கள்: திறந்த டிக்கெட்டுகள், technician க்காகக் காத்திருக்கும் வேலைகள், படிக்காத alerts போன்றவை." },
        { title: "பட்டியல்கள் மற்றும் தேடல்", body: "ஒவ்வொரு டிக்கெட் பட்டியலிலும் தேடல் பெட்டியும் status / priority வடிகட்டிகளும் உள்ளன. **See all** முழுப் பட்டியலைத் திறக்கும்." },
        { title: "டிக்கெட் விவரம்", body: "எந்த டிக்கெட்டிலும் **Open** அழுத்துங்கள்; அதன் முழு விவரம் **பட்டியல்களுக்குக் கீழே** திறக்கும் — கீழே scroll செய்யுங்கள். Status பொத்தான்கள், ஒதுக்குதல், புகைப்படங்கள், பதில்கள், வரலாறு அனைத்தும் அங்கே உள்ளன." }
      ]
    },
    roles: [
      {
        role: "customer",
        title: "வாடிக்கையாளர் போர்ட்டல் (Customer Portal)",
        summary: "ஒரு பிரச்சினையைப் புகாரளித்து அது தீரும் வரை பின்தொடரும் வாடிக்கையாளர்களுக்கு.",
        tasks: [
          {
            title: "டிக்கெட் உருவாக்குதல்",
            images: ["customer-new-ticket"],
            steps: [
              "**Create New Ticket** இல் **Job Type** ஐத் தேர்ந்தெடுங்கள்: Service, Fault, Installation அல்லது Other.",
              "பிரச்சினை உள்ள **Department** ஐச் சேருங்கள் — கண்டுபிடிக்க உதவுமானால் (கட்டாயமில்லை).",
              "சிறிய **Problem Summary** ஒன்றை எழுதி, பொருந்தும் **Common Problems** ஐ tick செய்து, மற்ற விவரங்களைச் சேருங்கள்.",
              "**Priority** மற்றும் இடத்தின் **Location** ஐ அமையுங்கள். தொலைபேசியில், **Use my location** உங்கள் GPS இருப்பிடத்தை நிரப்பும்.",
              "வேறொருவர் technician ஐச் சந்திப்பார் என்றால், அவரது **Site contact number** ஐச் சேருங்கள்.",
              "யாருடனாவது பேச விரும்பினால் **Need phone callback?** ஐ tick செய்து, **Submit Ticket** அழுத்துங்கள்."
            ]
          },
          {
            title: "உங்கள் டிக்கெட்டுகளைப் பின்தொடருங்கள்",
            images: ["customer-my-tickets"],
            steps: [
              "நீங்கள் உருவாக்கும் ஒவ்வொரு டிக்கெட்டும் அதன் தற்போதைய நிலையுடன் **My Tickets** இல் பட்டியலிடப்படும்.",
              "டிக்கெட்டில் **Open** அழுத்தி பட்டியல்களுக்குக் கீழே முழு விவரத்தைப் பாருங்கள்: விவரங்கள், புகைப்படங்கள், technician, உரையாடல் மற்றும் வரலாறு.",
              "பழைய டிக்கெட்டைக் கண்டுபிடிக்க தேடல் பெட்டியையும் வடிகட்டிகளையும் பயன்படுத்துங்கள்."
            ]
          },
          {
            title: "ABSL உடன் பேசுங்கள்",
            images: ["customer-conversation"],
            steps: [
              "டிக்கெட்டின் கீழே உள்ள **Conversation** பெட்டியில் எழுதி **Send** அழுத்துங்கள். ABSL பதிலளிக்கும் ஒவ்வொரு முறையும் உங்களுக்கு மின்னஞ்சல் அனுப்புவோம்.",
              "தொலைபேசி அழைப்பை விரும்புகிறீர்களா? டிக்கெட்டில் **Prefer a phone call?** ஐப் பயன்படுத்தி உங்கள் எண்ணை உள்ளிடுங்கள்."
            ]
          },
          {
            title: "டிக்கெட்டை மாற்றுதல் அல்லது மூடுதல்",
            images: ["customer-close"],
            steps: [
              "டிக்கெட் இன்னும் **New** நிலையில் இருந்தால், அதைத் திருத்த **Edit ticket details** ஐத் திறங்கள்.",
              "வேலை முடிந்ததும் தீர்வுக் குறிப்புகள் மற்றும் service call எண்ணுடன் மின்னஞ்சல் வரும். திருப்தியானதும் **Closed** அழுத்துங்கள்."
            ]
          }
        ]
      },
      {
        role: "technician",
        title: "தொழில்நுட்பவியலாளர் செயலி (Technician Field App)",
        summary: "ABSL களத் technicians க்கு: உங்கள் வேலைகள், திறந்த வேலைத் தொகுப்பு, உங்கள் சொந்த வேலைகளைப் பதிவு செய்தல்.",
        tasks: [
          {
            title: "உங்கள் வேலை எண்ணிக்கைகள்",
            images: ["tech-counts"],
            steps: [
              "மேலே உள்ள அட்டைகள் உங்கள் வேலைகளை எண்ணுகின்றன: **New** (உங்களுக்கு வழங்கப்பட்டது, இன்னும் திறக்கவில்லை), **Assigned** (திறந்தது, தொடங்கவில்லை), **Ongoing** (In Progress) மற்றும் **Resolved** (தீர்த்தது அல்லது மூடியது).",
              "அந்த வேலைகளை மட்டும் My Job Reports இல் பார்க்க ஒரு அட்டையைத் தட்டுங்கள்."
            ]
          },
          {
            title: "Open Jobs இலிருந்து வேலையை எடுங்கள்",
            images: ["tech-open-jobs"],
            steps: [
              "ஒரு வேலை அனைத்து technicians க்கும் திறக்கப்படும்போது, உங்கள் பக்கத்தின் மேலே **Open Jobs** தோன்றும்.",
              "வேலையில் **Open** அழுத்தி, **Technician → Assign or hand over** இன் கீழ் உங்கள் பெயரைத் தேர்ந்தெடுத்து **Assign** அழுத்துங்கள். முதலில் ஏற்கும் technician க்கு வேலை கிடைக்கும்."
            ]
          },
          {
            title: "உங்கள் வேலைகளைச் செய்யுங்கள்",
            images: ["tech-status", "tech-photos"],
            steps: [
              "**My Jobs** இல் உங்களுக்கு ஒதுக்கப்பட்ட அனைத்து வேலைகளும் உள்ளன. ஒன்றில் **Open** அழுத்துங்கள்.",
              "தொடங்கும்போது **In Progress** அழுத்துங்கள். அழைக்க site contact எண்ணைத் தட்டுங்கள், அல்லது இடத்தைக் கண்டுபிடிக்க **Open map** அழுத்துங்கள்.",
              "வேலை செய்யும்போது **Add photo** மூலம் புகைப்படங்களைச் சேர்த்து, **Conversation** இல் வாடிக்கையாளருக்குத் தகவல் தெரிவியுங்கள்."
            ]
          },
          {
            title: "வேலையைத் தீர்த்தல் (Resolve)",
            images: ["tech-resolve"],
            steps: [
              "**Resolved** அழுத்துங்கள். **Service call number**, உங்கள் **Resolution notes** மற்றும் **Receipt photo** ஐ உள்ளிடுங்கள் — மூன்றும் கட்டாயம்.",
              "**Resolve** அழுத்துங்கள். உங்கள் குறிப்புகளும் service call எண்ணும் வாடிக்கையாளருக்கு மின்னஞ்சல் செய்யப்படும், ரசீது கோப்பில் சேமிக்கப்படும்."
            ]
          },
          {
            title: "வேலையைச் சக ஊழியரிடம் ஒப்படைத்தல்",
            images: ["tech-handover"],
            steps: [
              "வேலையைத் திறந்து, **Assign or hand over** இன் கீழ் சக ஊழியரைத் தேர்ந்தெடுத்து, காரணத்தைச் சேர்த்து **Reassign** அழுத்துங்கள். ஒப்படைப்புக் குறிப்பு உரையாடலில் தோன்றும்."
            ]
          },
          {
            title: "வேலையைப் பதிவு செய்தல் (Log a Job)",
            images: ["tech-my-jobs", "tech-log-job"],
            steps: [
              "போர்ட்டல் வழியாக வராத வேலைகளுக்கு **Log a Job** அழுத்துங்கள்.",
              "வாடிக்கையாளர் உங்களை அழைத்தால்: நிறுவனம், அழைப்பவரின் பெயர் மற்றும் தொலைபேசி, job type, **Fault location** மற்றும் பிரச்சினையை உள்ளிடுங்கள்.",
              "யாரும் அழைக்காத, நீங்களே செய்ய வேண்டிய வேலை என்றால்: **This is my own job** ஐ tick செய்யுங்கள் — அது உடனே உங்களுக்கு ஒதுக்கப்படும்.",
              "கீழே உள்ள கேள்விக்குப் பதிலளியுங்கள்: **Yes** என்றால் அனைத்து technicians க்கும் திறக்கும் (Open Jobs க்குச் செல்லும்); **No** என்றால் உங்களுக்கு ஒதுக்கப்படும். பின்னர் **Log Job** அழுத்துங்கள்."
            ]
          },
          {
            title: "பயணத்தைத் திட்டமிடுதல் (Trip Planner)",
            images: ["trip-planner-phone"],
            steps: [
              "தொலைதூரம் செல்கிறீர்களா? மெனு பட்டையிலிருந்து **Trip Planner** ஐத் திறங்கள், அல்லது திறந்த வேலையில் **Plan a trip** அழுத்துங்கள்.",
              "**Going to** இல் செல்லும் இடத்தைத் தேர்ந்தெடுங்கள்: ஒரு வேலை, ஒரு நகரம், அல்லது உங்களைச் சுற்றியுள்ள வாடிக்கையாளர் இடங்கள். வழியில் உள்ள நிலுவைச் சேவைகள் tick செய்யப்பட்டிருக்கும்; **Other client sites on the way** (நிலுவை இல்லாத இடங்கள்) ஐயும் tick செய்யலாம்.",
              "நீண்ட பயணங்கள் நாட்களாகப் பிரிக்கப்படும் (**Driving day** மற்றும் **Time at each stop** ஐ அமையுங்கள்). ஒவ்வொரு நாளுக்கும் தனி Google Maps இணைப்பு உண்டு; ஒரு நாள் பயணத்துக்கு **Open route in Google Maps** உள்ளது.",
              "**Share trip** நிறுத்தங்களையும் இணைப்புகளையும் WhatsApp க்கு அனுப்பும்; **Print trip sheet** service call எண்களுக்கான இடத்துடன் அச்சிடும்.",
              "ஒவ்வொரு நிறுத்தத்திலும் **Start service** அழுத்துங்கள் (நிலுவை இல்லாத இடத்தில் **Start visit**): அது உங்கள் வேலையாகும். **In Progress** ஆக்கி, பின்னர் service call எண் மற்றும் ரசீதுப் புகைப்படத்துடன் **Resolved** செய்யுங்கள்; சேவை முடிந்ததாகக் குறிக்கப்படும்."
            ]
          },
          {
            title: "My Job Reports",
            images: ["my-reports-filters", "my-reports-table"],
            steps: [
              "மெனு பட்டையிலிருந்து **My Job Reports** ஐத் திறங்கள். உங்களுக்கு ஒதுக்கப்பட்ட அனைத்து வேலைகளும் — உங்களுடையவை மட்டும் — அதில் உள்ளன.",
              "**Job Status**, **Job Type**, **From Date** / **To Date**, **Service Call No** அல்லது **Customer Name** மூலம் (எந்தக் கலவையிலும்) வடிகட்டி, **Generate Report** அழுத்துங்கள். மீண்டும் தொடங்க **Reset Filters**.",
              "அட்டவணையில், எந்த நெடுவரிசையையும் அதன் தலைப்பால் வரிசைப்படுத்துங்கள், தலைப்புகளுக்குக் கீழே உள்ள வரியில் ஒவ்வொரு நெடுவரிசையையும் வடிகட்டுங்கள், அல்லது முழு அறிக்கையிலும் தேடுங்கள்.",
              "**Download Excel** ஒரு Excel கோப்பைச் சேமிக்கும், **Print Report** அறிக்கையை மட்டும் அச்சிடும்."
            ]
          }
        ]
      },
      {
        role: "operator",
        title: "Operator",
        summary: "ABSL operators மற்றும் CEO க்கு: டிக்கெட் வரிசை, வேலை அனுப்புதல், callbacks, அறிக்கைகள், புதிய கணக்குகள், அமைப்பை நன்றாக வைத்திருத்தல் — அனைத்தும் ஒரே இடத்தில்.",
        tasks: [
          {
            title: "Ticket Queue உடன் வேலை செய்தல்",
            images: ["operator-queue"],
            steps: [
              "**Ticket Queue** இல் தேடல் மற்றும் வடிகட்டிகளுடன் அனைத்து டிக்கெட்டுகளும் உள்ளன. சுருக்க அட்டைகளில் **Waiting for a technician** இன்னும் யாருக்கும் கிடைக்காத வேலைகளை எண்ணுகிறது.",
              "டிக்கெட்டில் **Open** அழுத்தி அதை வரிசைக்குக் கீழே பாருங்கள்."
            ]
          },
          {
            title: "ஒதுக்குதல் அல்லது அனுப்புதல்",
            images: ["operator-assign"],
            steps: [
              "ஒருவருக்கு வேலை கொடுக்க: **Technician** இன் கீழ் அவரைத் தேர்ந்தெடுத்து **Assign** அழுத்துங்கள். அவருக்கு உடனே மின்னஞ்சல் செல்லும்.",
              "முதலில் கிடைக்கும் technician எடுக்க விட: **Dispatch** இன் கீழ் **Release to all technicians** அழுத்துங்கள். அனைத்து technicians உம் அதை Open Jobs இல் பார்ப்பார்கள்."
            ]
          },
          {
            title: "வாடிக்கையாளருக்குத் தகவல் தெரிவித்தல்",
            images: [],
            steps: [
              "**Conversation** இல் பதிலளியுங்கள் — வாடிக்கையாளருக்கு மின்னஞ்சல் செல்லும். **Status** பொத்தான்கள் மூலம் டிக்கெட்டை முன்னேற்றுங்கள்; **Resolved** க்கு service call எண், குறிப்புகள் மற்றும் ரசீதுப் புகைப்படம் தேவை."
            ]
          },
          {
            title: "Callbacks மற்றும் தொலைபேசி அழைப்புகள்",
            images: ["operator-callbacks"],
            steps: [
              "**Callback Queue** இல் அழைப்புக்காகக் காத்திருக்கும் வாடிக்கையாளர்கள் உள்ளனர். **Call** அழுத்தி (தொலைபேசியில்), பேசியதும் **Done** அழுத்துங்கள்.",
              "போர்ட்டலுக்குப் பதிலாக தொலைபேசியில் அழைத்த வாடிக்கையாளருக்கு **Log a Job** பயன்படுத்துங்கள். அனைத்து technicians க்கும் திறக்க **Yes**, பின்னர் ஒதுக்க **No**."
            ]
          },
          {
            title: "அறிக்கைகள் (Reports)",
            images: ["reports"],
            steps: [
              "**Reports** ஐத் திறந்து **Report Type** ஒன்றைத் தேர்ந்தெடுங்கள் — Technician Wise, Customer Wise, Date Wise, All Faults, Service Call Number அல்லது All Jobs.",
              "அதன் வடிகட்டிகளை அமைத்து **Generate Report** அழுத்துங்கள்.",
              "முன்னோட்டத்தில், தலைப்பைக் கிளிக் செய்து எந்த நெடுவரிசையையும் வரிசைப்படுத்துங்கள், ஒவ்வொரு நெடுவரிசையையும் வடிகட்டுங்கள், அல்லது முழு அறிக்கையிலும் தேடுங்கள்.",
              "**Download Excel** Excel கோப்பைச் சேமிக்கும், **Print Report** அச்சிடும், **Open Report** முழுத் திரையில் காட்டும்."
            ]
          },
          {
            title: "Service Plan மற்றும் பயணங்கள்",
            images: ["service-plan","trip-planner-office"],
            steps: [
              "**Service Plan** ஒவ்வொரு வாடிக்கையாளர் இடத்தையும் வரைபடத்தில் (சிவப்பு overdue, நீலம் pending, பச்சை done, சாம்பல் நிலுவை இல்லை) மற்றும் நிலுவைச் சேவைகளை அட்டவணையில் காட்டும்.",
              "புதுப்பிக்கப்பட்ட சேவை sheet ஐ ஏற்ற: **Download template** (உங்கள் இடங்கள் Excel sheet ஆக) எடுத்து Contract year, Status, Date done மற்றும் Service call ஐ நிரப்பி, **Import from Excel** செய்யுங்கள். எதுவும் சேமிக்கப்படும் முன் என்ன மாறும் என்பதைப் பார்ப்பீர்கள்.",
              "**Mark sites due** ஒரு ஒப்பந்த ஆண்டுக்கு வாடிக்கையாளரின் ஒவ்வொரு இடத்துக்கும் சேவையைச் சேர்க்கும் (Seylan க்கு 1st service மற்றும் 2nd service). **Mark done** helpdesk க்கு வெளியே செய்த சேவையைப் பதிவு செய்யும்; **Skip** ஒரு இடத்தை விலக்கும்.",
              "**Add site** அல்லது **Edit**: இடத்தின் தொடர்பு நபர் மற்றும் தொலைபேசி (பயணங்களில் technicians க்குக் காட்டப்படும்), device serial, சரியான வரைபட இருப்பிடம் (Google Maps இலிருந்து எண்களை paste செய்யுங்கள்). ABSL இனி சேவை செய்யாத இடங்களுக்கு **Active** ஐ untick செய்யுங்கள்.",
              "**Plan a trip** **Trip Planner** ஐத் திறக்கும். **Give these stops to** இல் technician ஐத் தேர்ந்தெடுத்து **Assign the trip** அழுத்துங்கள்: ஒவ்வொரு நிறுத்தமும் அவருக்கு வேலையாகும், அவருக்கு மின்னஞ்சல் செல்லும்.",
              "ABSL அலுவலகத்தின் சரியான இருப்பிடத்தை ஒருமுறை அமையுங்கள் (பக்கத்தின் மேலே உள்ள அறிவிப்பு): ஒவ்வொரு பயணமும் அங்கிருந்து தொடங்கும்."
            ]
          },
          {
            title: "புதிய கணக்குகளை அங்கீகரித்தல்",
            images: ["operator-approvals"],
            steps: [
              "**User Approvals** இல் மதிப்பாய்வுக்காகக் காத்திருக்கும் புதிய பதிவுகள் உள்ளன.",
              "வழங்க வேண்டிய பங்கைத் தேர்ந்தெடுங்கள் — அவர்கள் கேட்டதிலிருந்து தொடங்கும் — பின்னர் **Approve** அல்லது **Reject** அழுத்துங்கள். முடிவு அவர்களுக்கு மின்னஞ்சல் செய்யப்படும்.",
              "Operators Customer அல்லது Technician ஆக அங்கீகரிக்கலாம். Operator மற்றும் CEO அணுகலை CEO Main Console இல் வழங்குவார்."
            ]
          },
          {
            title: "நிறுவனக் கணக்கு வரம்புகள்",
            images: [],
            steps: [
              "ஒரு நிறுவனத்துக்குக் கணக்குகள் தீர்ந்தால், **Company Limit** இன் கீழ் அதைத் தேர்ந்தெடுத்து, புதிய வரம்பை உள்ளிட்டு **Update Limit** அழுத்துங்கள்."
            ]
          },
          {
            title: "அமைப்பை நன்றாக வைத்திருத்தல்",
            images: [],
            steps: [
              "**Alerts** அனுப்ப முடியாத மின்னஞ்சல்கள் அல்லது சேமிப்பிடம் நிரம்புதல் போன்ற பிரச்சினைகளைக் காட்டும் — ஒவ்வொன்றையும் கையாண்டதும் **Acknowledge** அழுத்துங்கள்.",
              "**Notifications** என்பது மின்னஞ்சல் வரிசை — தோல்வியடைந்ததை **Retry** செய்யுங்கள்.",
              "**Receipts** மற்றும் **Client Errors** வேலைகளைச் சரிபார்க்கவும் பிரச்சினைகளைக் கண்டறியவும் உள்ள பதிவுகள்."
            ]
          }
        ]
      },
      {
        role: "main-console",
        title: "Main Console (CEO மட்டும்)",
        summary: "CEO க்கு: யாருக்கு எந்தப் பங்கு, சேமிப்பிட இடம் மற்றும் backups. CEO செய்யும் மற்ற அனைத்தும் Operator இடைமுகத்தில் உள்ளன.",
        tasks: [
          {
            title: "ஒருவரைப் பதவி உயர்த்துதல் அல்லது பங்கை மாற்றுதல்",
            images: ["main-console-staff"],
            steps: [
              "மெனு பட்டையிலிருந்து **Main Console** ஐத் திறங்கள்.",
              "**Manage Staff** இன் கீழ், எந்தக் கணக்குக்கும் புதிய பங்கைத் தேர்ந்தெடுத்து **Update Role** அழுத்துங்கள் — ஒருவரை Operator, Technician அல்லது மற்றொரு CEO ஆக்குங்கள்.",
              "உங்கள் சொந்தப் பங்கை இரண்டாவது CEO கணக்கிலிருந்து மட்டுமே மாற்ற முடியும்."
            ]
          },
          {
            title: "சேமிப்பிட இடம் மற்றும் backups",
            images: ["main-console-backup"],
            steps: [
              "**Free plan space and backups** புகைப்படச் சேமிப்பிடமும் database இடமும் எவ்வளவு பயன்படுத்தப்பட்டுள்ளன என்பதைக் காட்டும். 80% இல் System Alert எச்சரிக்கும்.",
              "அனைத்தும் தினமும் தானாக helpdesk Google Drive க்கு நகலெடுக்கப்படும் (**ABSL Helpdesk** கோப்புறை): ரசீதுகள், வேலைப் புகைப்படங்கள், மாதாந்திர அறிக்கைகள் மற்றும் முழு backup.",
              "**Download backup** USB drive இல் வைத்திருக்க கூடுதல் நகலை இப்போதே தரும்."
            ]
          },
          {
            title: "பயனர்கள் பார்ப்பது போலவே போர்ட்டலைப் பாருங்கள்",
            images: [],
            steps: [
              "**Preview a portal** Customer Portal அல்லது Technician Field App ஐத் திறக்கும். மஞ்சள் பட்டை உங்களை Operator dashboard க்குத் திரும்ப அழைத்துச் செல்லும்."
            ]
          }
        ]
      }
    ],
    tickets: {
      statuses: {
        new: "இப்போதுதான் உருவாக்கப்பட்டது. இன்னும் யாரும் வேலையைத் தொடங்கவில்லை.",
        in_progress: "ஒரு technician அதில் வேலை செய்கிறார்.",
        resolved: "வேலை முடிந்தது. Technician service call எண்ணையும் செய்ததையும் பதிவு செய்துள்ளார்.",
        closed: "முடிக்கப்பட்டு கோப்பில் சேர்க்கப்பட்டது."
      },
      notes: [
        "**Priority** (High, Medium, Low) ஒரு வேலை எவ்வளவு அவசரம் என்பதைச் சொல்லும். **Job type** (Service, Fault, Installation, Other) அது எந்த வகை வேலை என்பதைச் சொல்லும்.",
        "**அறிக்கைகளில்**, ஏற்கனவே technician உள்ள New வேலை **Assigned** ஆகவும், In Progress **Ongoing** ஆகவும் காட்டப்படும்.",
        "**டிக்கெட்டை யார் முன்னேற்றலாம்:** technicians தங்கள் வேலைகளை In Progress அல்லது Resolved ஆக்கலாம்; operators மற்றும் CEO எந்த நிலையையும் அமைக்கலாம்; வாடிக்கையாளர்கள் தங்கள் டிக்கெட்டுகளை மூடலாம்."
      ]
    },
    emails: [
      "**அனைவருக்கும்:** பதிவு செய்யும்போது உறுதிப்படுத்தல் இணைப்பு, கணக்கு அங்கீகரிக்கப்பட்டால் (அல்லது இல்லாவிட்டால்) செய்தி, கேட்கும்போது கடவுச்சொல் மீட்டமைப்பு இணைப்புகள்.",
      "**வாடிக்கையாளர்களுக்கு:** டிக்கெட் உருவாக்கப்பட்டது, ஒவ்வொரு நிலை மாற்றமும், ABSL பதில்கள், குறிப்புகள் மற்றும் service call எண்ணுடன் தீர்வு.",
      "**Technicians க்கு:** ஒரு வேலை உங்களுக்கு ஒதுக்கப்படும்போது, உங்கள் வேலையில் வாடிக்கையாளர் பதிலளிக்கும்போது.",
      "**Operators மற்றும் CEO க்கு:** இன்னும் technician இல்லாத டிக்கெட்டில் வாடிக்கையாளர் பதிலளிக்கும்போது."
    ],
    faq: [
      { q: "எனக்கு உறுதிப்படுத்தல் மின்னஞ்சல் வரவில்லை.", a: "சில நிமிடங்கள் காத்திருந்து spam அல்லது junk கோப்புறையைப் பாருங்கள். இன்னும் இல்லையா? நீங்கள் பதிவு செய்த முகவரியுடன் கீழே உள்ள முகவரிக்கு மின்னஞ்சல் அனுப்புங்கள்." },
      { q: "“Waiting for approval” என்று காட்டுகிறது.", a: "உங்கள் கணக்கை ABSL அங்கீகரிக்க வேண்டும். அங்கீகரித்தவுடன் மின்னஞ்சல் வரும் — பின்னர் மீண்டும் உள்நுழையுங்கள்." },
      { q: "கடவுச்சொல்லை மறந்துவிட்டேன்.", a: "Login பக்கத்தில் **Forgot password?** அழுத்துங்கள். நாங்கள் அனுப்பும் இணைப்பு ஒரு முறை மட்டுமே வேலை செய்யும், சிறிது நேரத்தில் காலாவதியாகும்." },
      { q: "“You do not have permission to do that” என்று காட்டுகிறது.", a: "அந்தச் செயல் உங்கள் பங்குக்குக் கிடையாது, அல்லது நீங்கள் திறந்த பிறகு டிக்கெட் மாறியுள்ளது (எ.கா. வேறொரு technician வேலையை ஏற்றார்). பக்கத்தை reload செய்து மீண்டும் முயலுங்கள்." },
      { q: "வேறொருவர் இந்த டிக்கெட்டைப் புதுப்பித்ததாகக் காட்டுகிறது.", a: "இருவர் ஒரே நேரத்தில் மாற்றினர். அவர்களின் மாற்றத்தைப் பார்க்க reload செய்து, பின்னர் உங்கள் மாற்றத்தைச் செய்யுங்கள்." },
      { q: "டிக்கெட்டைக் கண்டுபிடிக்க முடியவில்லை.", a: "தேடல் பெட்டியை அழித்து வடிகட்டிகளை **All statuses** மற்றும் **Any priority** ஆக மாற்றுங்கள், அல்லது முழுப் பட்டியலுக்கு **See all** அழுத்துங்கள்." },
      { q: "மேலே உள்ள அடையாளம் Offline என்று காட்டுகிறது.", a: "உங்கள் இணைய இணைப்பு துண்டிக்கப்பட்டுள்ளது. அது திரும்பும் வரை நீங்கள் செய்யும் எந்த மாற்றமும் சேமிக்கப்படாது." },
      { q: "என் புகைப்படம் பதிவேற்ற நீண்ட நேரம் ஆகிறது.", a: "புகைப்படங்கள் அனுப்பப்படும் முன் உங்கள் தொலைபேசியிலேயே சிறிதாக்கப்படுவதால், பொதுவாகக் காரணம் மெதுவான இணைப்பு. பக்கத்தை விட்டு வெளியேறும் முன் வெற்றிச் செய்தி வரும் வரை காத்திருங்கள்." },
      { q: "Helpdesk ஐ என் தொலைபேசியின் home screen இல் வைக்கலாமா?", a: "ஆம். Android (Chrome) இல் **⋮** மெனுவைத் திறந்து **Add to Home screen** அல்லது **Install app** ஐத் தேர்ந்தெடுங்கள். iPhone (Safari) இல் **Share** தட்டி, பின்னர் **Add to Home Screen** ஐத் தேர்ந்தெடுங்கள்." }
    ]
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { GUIDE_IMAGES, GUIDE_LANGUAGES, GUIDE_CONTENT };
}
