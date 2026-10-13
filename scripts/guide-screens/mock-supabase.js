/* Stand-in for supabase-js, used only by scripts/guide-screens/capture.js
 * to photograph the app for the User Guide. Served in place of
 * vendor/supabase-js-*.js; never deployed. Every name and number here is
 * made-up sample data.
 *
 * window.__MOCK_ROLE (set before the page loads) picks who is signed in:
 * customer, technician, operator or admin. */
(function () {
  const role = window.__MOCK_ROLE || "customer";
  const now = Date.now();
  const ago = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const uuid = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

  const people = {
    customer: { id: uuid(1), full_name: "Nimal Fernando", email: "nimal@keells-sample.lk", role: "customer", company_id: uuid(101) },
    technician: { id: uuid(2), full_name: "Kasun Perera", email: "kasun@absl-sample.lk", role: "technician", company_id: uuid(100) },
    technician2: { id: uuid(3), full_name: "Ruwan Silva", email: "ruwan@absl-sample.lk", role: "technician", company_id: uuid(100) },
    operator: { id: uuid(4), full_name: "Dilini Jayasinghe", email: "dilini@absl-sample.lk", role: "operator", company_id: uuid(100) },
    admin: { id: uuid(5), full_name: "Sunil Wickramasinghe", email: "ceo@absl-sample.lk", role: "admin", company_id: uuid(100) }
  };
  const me = { ...(people[role] || people.customer), approval_status: "approved", phone: "0771234567" };

  const companies = [
    { id: uuid(100), name: "Automated Barcode Solutions", account_limit: 50, status: "active" },
    { id: uuid(101), name: "Keells Super - Colombo 03", account_limit: 10, status: "active" },
    { id: uuid(102), name: "Lanka Pharmacy", account_limit: 10, status: "active" },
    { id: uuid(103), name: "City Hardware", account_limit: 10, status: "active" }
  ];
  const companyName = (id) => (companies.find((c) => c.id === id) || {}).name || "";

  const T = (n, o) => ({
    id: uuid(200 + n),
    ticket_number: "ABSL-2026-0000" + (40 + n),
    version: 1,
    department: "Billing counter",
    location_name: "Colombo 03",
    site_contact_phone: "0112345678",
    wants_callback: false,
    open_for_claim: false,
    assigned_agent_id: null,
    caller_name: null,
    caller_phone: null,
    installation_number: null,
    reference_number: null,
    service_call_number: null,
    resolution_notes: null,
    location_lat: null,
    location_lng: null,
    ...o
  });

  let tickets = [
    T(1, { title: "Barcode printer not printing labels", description: "Printer shows a red light and feeds blank labels.", status: "new", priority: "high", job_type: "fault", created_by: people.customer.id, company_id: uuid(101), assigned_technician_id: people.technician.id, created_at: ago(2) }),
    T(2, { title: "Scanner not reading QR codes", description: "Handheld scanner beeps but nothing appears on screen.", status: "in_progress", priority: "medium", job_type: "fault", created_by: people.customer.id, company_id: uuid(101), assigned_technician_id: people.technician.id, created_at: ago(20) }),
    T(3, { title: "Install two new POS scanners", description: "New counters 5 and 6.", status: "new", priority: "low", job_type: "installation", created_by: people.operator.id, caller_name: "Mrs. Perera", caller_phone: "0779876543", company_id: uuid(102), assigned_technician_id: null, open_for_claim: true, created_at: ago(5) }),
    T(4, { title: "Label printer service", description: "Quarterly service.", status: "resolved", priority: "medium", job_type: "service", created_by: people.customer.id, company_id: uuid(101), assigned_technician_id: people.technician.id, service_call_number: "SC-2026-0042", resolution_notes: "Cleaned print head and replaced the platen roller. Test labels OK.", created_at: ago(70) }),
    T(5, { title: "Receipt printer paper jam", description: "Paper jams every few receipts.", status: "new", priority: "high", job_type: "fault", created_by: people.operator.id, caller_name: "Mr. Silva", caller_phone: "0712223344", company_id: uuid(103), assigned_technician_id: null, created_at: ago(1) }),
    T(6, { title: "Data collector battery issue", description: "Battery drains in two hours.", status: "closed", priority: "low", job_type: "fault", created_by: people.customer.id, company_id: uuid(101), assigned_technician_id: people.technician2.id, service_call_number: "SC-2026-0031", created_at: ago(240) })
  ];
  if (role === "customer") tickets = tickets.filter((t) => t.created_by === people.customer.id);
  if (role === "technician") tickets = tickets.filter((t) => t.assigned_technician_id === people.technician.id || t.open_for_claim);

  const nameOf = (id) => (Object.values(people).find((p) => p.id === id) || {}).full_name || null;
  const ticketRows = () =>
    tickets.map((t) => ({ ...t, created_by_profile: { full_name: nameOf(t.created_by) }, company: { name: companyName(t.company_id) } }));

  const comments = [
    { id: uuid(301), ticket_id: uuid(202), author_id: people.customer.id, body: "The scanner stopped working this morning.", created_at: ago(19) },
    { id: uuid(302), ticket_id: uuid(202), author_id: people.technician.id, body: "On my way - I will be there by 11am.", created_at: ago(3) }
  ];

  const photo = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220"><rect width="320" height="220" fill="#e2e8f0"/>' +
    '<rect x="70" y="40" width="180" height="140" rx="10" fill="#94a3b8"/><rect x="95" y="65" width="130" height="18" fill="#f8fafc"/>' +
    '<rect x="95" y="95" width="90" height="10" fill="#f8fafc"/><rect x="95" y="115" width="110" height="10" fill="#f8fafc"/></svg>');

  const detailFor = (id) => {
    const t = tickets.find((x) => x.id === id) || tickets[0];
    if (!t) return null;
    return {
      ticket: t,
      created_by_name: nameOf(t.created_by),
      company_name: companyName(t.company_id),
      attachments: t.status === "resolved"
        ? [{ id: uuid(401), bucket_name: "ticket-service-receipts", file_path: t.id + "/receipt.jpg", file_type: "service_receipt", mime_type: "image/jpeg", original_name: "receipt.jpg", file_size: 240000, uploaded_by: people.technician.id, created_at: ago(60) }]
        : [{ id: uuid(402), bucket_name: "ticket-photos", file_path: t.id + "/photo.jpg", file_type: "photo", mime_type: "image/jpeg", original_name: "printer.jpg", file_size: 210000, uploaded_by: people.technician.id, created_at: ago(2) }],
      history: [
        { new_status: "new", old_status: null, changed_by_name: nameOf(t.created_by), created_at: t.created_at },
        ...(t.status !== "new" ? [{ new_status: "in_progress", old_status: "new", changed_by_name: "Kasun Perera", created_at: ago(4) }] : [])
      ],
      parts_used: [],
      callback: null
    };
  };

  const jobRow = (t) => ({
    id: t.id, created_at: t.created_at, ticket_number: t.ticket_number, title: t.title, description: t.description,
    status: t.status, job_type: t.job_type, priority: t.priority, service_call_number: t.service_call_number,
    installation_number: null, reference_number: null, resolution_notes: t.resolution_notes,
    resolved_at: t.status === "resolved" || t.status === "closed" ? ago(48) : null,
    company_id: t.company_id, company_name: companyName(t.company_id), customer_name: nameOf(t.created_by),
    customer_email: null, caller_name: t.caller_name, caller_phone: t.caller_phone,
    technician_id: t.assigned_technician_id, technician_name: nameOf(t.assigned_technician_id),
    technician_notes: null, assigned_at: t.created_at, opened: t.status !== "new" || t.id === uuid(204)
  });

  const tables = {
    profiles: () => (role === "admin" ? Object.values(people).map((p) => ({ ...p, approval_status: "approved" })) : [me]),
    tickets: ticketRows,
    ticket_comments: () => comments,
    staff_directory: () => Object.values(people).filter((p) => p.role !== "customer").map((p) => ({ id: p.id, full_name: p.full_name, role: p.role })),
    companies: () => companies,
    inventory_items: () => [
      { id: uuid(501), sku: "PH-110", name: "Print head 110mm", category: "Printer parts", quantity_on_hand: 6, reorder_level: 2 },
      { id: uuid(502), sku: "RL-58", name: "Platen roller", category: "Printer parts", quantity_on_hand: 1, reorder_level: 3 }
    ],
    callback_requests: () => [{ id: uuid(601), ticket_id: uuid(205), phone: "0712223344", status: "pending", created_at: ago(1), requested_by: people.customer.id }],
    approval_requests: () => [
      { profile_id: uuid(701), company_name: "Lanka Pharmacy", requested_email: "manager@lankapharmacy-sample.lk", requested_role: "customer", status: "pending", created_at: ago(3) },
      { profile_id: uuid(702), company_name: "Automated Barcode Solutions", requested_email: "new.tech@absl-sample.lk", requested_role: "technician", status: "pending", created_at: ago(6) }
    ],
    notifications: () => [
      { id: uuid(801), channel: "email", subject: "Job assigned: ABSL-2026-000041", status: "sent", attempts: 1, created_at: ago(2) },
      { id: uuid(802), channel: "email", subject: "Ticket resolved: ABSL-2026-000044", status: "sent", attempts: 1, created_at: ago(48) }
    ],
    admin_alerts: () => [],
    ticket_receipts: () => [],
    client_error_logs: () => [],
    ticket_attachments: () => []
  };

  const rpcs = {
    ticket_detail: (args) => detailFor(args && args.p_ticket_id),
    my_job_report: () => tickets.filter((t) => t.assigned_technician_id === people.technician.id).map(jobRow),
    report_jobs: () => tickets.map(jobRow),
    free_plan_usage: () => ({ storage_bytes: 18350080, storage_limit: 1073741824, database_bytes: 19293798, database_limit: 524288000, files: 42, buckets: [], leftover: { files: 0, bytes: 0 }, last_backup_at: ago(3), last_backup_by: "Google Drive (automatic)" })
  };

  function query(source, kind, args) {
    const filters = [];
    let mode = "many";
    const builder = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          return (resolve, reject) => {
            try {
              let data = kind === "rpc" ? (rpcs[source] ? rpcs[source](args) : null) : (tables[source] ? tables[source]() : []);
              if (Array.isArray(data)) {
                data = data.filter((row) => filters.every(([col, val]) => !(col in row) || String(row[col]) === String(val)));
                if (mode !== "many") data = data[0] || null;
              }
              resolve({ data, error: null, count: Array.isArray(data) ? data.length : null });
            } catch (err) {
              reject(err);
            }
          };
        }
        if (prop === "eq") return (col, val) => { filters.push([col, val]); return builder; };
        if (prop === "single" || prop === "maybeSingle") return () => { mode = "one"; return builder; };
        return () => builder;
      }
    });
    return builder;
  }

  // "guest": nobody signed in (login and register pages).
  const user = role === "guest" ? null : { id: me.id, email: me.email };
  const subscription = { unsubscribe() {} };
  const channel = { on() { return channel; }, subscribe() { return channel; }, unsubscribe() {} };

  window.supabase = {
    createClient() {
      return {
        auth: {
          getUser: async () => ({ data: { user }, error: null }),
          getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription } }),
          signOut: async () => ({ error: null })
        },
        from: (table) => query(table, "table"),
        rpc: (name, args) => query(name, "rpc", args),
        channel: () => channel,
        removeChannel: () => {},
        storage: {
          from: () => ({
            createSignedUrl: async () => ({ data: { signedUrl: photo }, error: null }),
            createSignedUrls: async (paths) => ({ data: paths.map(() => ({ signedUrl: photo })), error: null }),
            upload: async () => ({ data: {}, error: null }),
            remove: async () => ({ data: [], error: null })
          })
        }
      };
    }
  };
})();
