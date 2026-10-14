// What capture.js photographs for the User Guide. Each becomes
// guide/<name>.webp. Phone-sized shots for the screens people mostly use
// on a phone (customers and technicians), desktop-sized for the office.
//
//   panel:    crop to the card whose heading starts with this text
//   section:  crop to one part of a card (its heading down to the next)
//   clip:     crop to a CSS selector
//   top:      crop to the top N pixels of the page
//   markText: outline in red the button/link containing this text
//   prepare:  clicks to make first, e.g. opening a form
const phone = { width: 390, height: 844, scale: 2 };
const desk = { width: 1280, height: 860, scale: 1 };

module.exports = [
  // Getting started
  { name: "register", path: "/register", role: "guest", ...phone, clip: "main#app", markText: ["Create Account"] },
  { name: "login", path: "/login", role: "guest", ...phone, clip: "main#app", markText: ["Forgot password"] },

  // Customer
  { name: "customer-new-ticket", path: "/customer", role: "customer", ...phone, panel: "Create New Ticket", markText: ["Submit Ticket"] },
  { name: "customer-my-tickets", path: "/customer", role: "customer", ...phone, panel: "My Tickets" },
  { name: "customer-conversation", path: "/customer", role: "customer", ...phone, section: "Conversation", markScope: "#ticketDetail", markText: ["Send"] },
  { name: "customer-close", path: "/customer", role: "customer", ...phone, section: "Status", markScope: "#ticketDetail", markText: ["Closed"] },

  // Technician
  { name: "tech-counts", path: "/technician", role: "technician", ...phone, clip: ".stats-grid" },
  { name: "tech-open-jobs", path: "/technician", role: "technician", ...phone, panel: "Open Jobs" },
  { name: "tech-my-jobs", path: "/technician", role: "technician", ...phone, panel: "My Jobs", markText: ["Log a Job"] },
  { name: "tech-status", path: "/technician", role: "technician", ...phone, section: "Status", markScope: "#ticketDetail", markText: ["In Progress"] },
  { name: "tech-photos", path: "/technician", role: "technician", ...phone, section: "Attachments", markScope: "#ticketDetail", markText: ["Add photo"] },
  { name: "tech-handover", path: "/technician", role: "technician", ...phone, section: "Technician", markScope: "#ticketDetail", markText: ["Reassign"] },
  {
    name: "tech-resolve", path: "/technician", role: "technician", ...phone, clip: "#modalCard",
    prepare: (page, h) => h.click("Resolved", "#ticketDetail")
  },
  {
    name: "tech-log-job", path: "/technician", role: "technician", ...phone, clip: "#modalCard",
    prepare: (page, h) => h.click("Log a Job")
  },
  { name: "my-reports-filters", path: "/my-reports", role: "technician", ...desk, clip: "section.report-controls", markText: ["Generate Report"] },
  { name: "my-reports-table", path: "/my-reports", role: "technician", ...desk, clip: "#reportPreview" },

  // Operator and CEO
  { name: "office-menu", path: "/operator", role: "admin", ...desk, top: 230 },
  { name: "operator-queue", path: "/operator", role: "operator", ...desk, panel: "Ticket Queue" },
  {
    name: "operator-assign", path: "/operator", role: "operator", ...desk, clip: "#ticketDetail aside", markText: ["Release to all technicians"],
    // A job nobody has yet (sample ticket ABSL-2026-000045).
    prepare: async (page) => {
      await page.evaluate(() => openTicket("00000000-0000-4000-8000-000000000205"));
      await new Promise((r) => setTimeout(r, 500));
    }
  },
  { name: "operator-callbacks", path: "/operator", role: "operator", ...desk, panel: "Callback Queue" },
  { name: "operator-approvals", path: "/operator", role: "operator", ...desk, panel: "User Approvals", markText: ["Approve"] },
  {
    name: "reports", path: "/reports", role: "operator", ...desk, clip: "main#app", markText: ["Download Excel"],
    prepare: async (page, h) => {
      await page.evaluate(() => {
        const select = [...document.querySelectorAll("select")].find((el) => [...el.options].some((o) => o.text.includes("All Jobs")));
        select.value = [...select.options].find((o) => o.text.includes("All Jobs")).value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await new Promise((r) => setTimeout(r, 300));
      await h.click("Generate Report");
    }
  },
  { name: "main-console-staff", path: "/main-console", role: "admin", ...desk, panel: "Manage Staff", markText: ["Update Role"] },
  { name: "main-console-backup", path: "/main-console", role: "admin", ...desk, panel: "Free plan space and backups" },

  // Service Plan and Trip Planner
  { name: "trip-planner", path: "/trip-planner#ticket=00000000-0000-4000-8000-000000000207", role: "technician", ...desk, clip: "main#app", markText: ["Open route in Google Maps"], wait: 1500 },
  { name: "trip-planner-phone", path: "/trip-planner#ticket=00000000-0000-4000-8000-000000000207", role: "technician", ...phone, clip: "main#app", wait: 1500 },
  { name: "service-plan", path: "/service-plan", role: "operator", ...desk, clip: "main#app", wait: 1500 }
];
