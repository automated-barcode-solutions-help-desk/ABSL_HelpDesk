create extension if not exists pgcrypto;

do $$ begin
  create type public.user_role as enum ('customer', 'agent', 'technician', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_status as enum ('new', 'in_progress', 'resolved', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'retry', 'dead_letter');
exception when duplicate_object then null; end $$;

create sequence if not exists public.ticket_number_seq;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_limit integer not null default 10,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_domains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  domain text not null unique,
  auto_approve boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id),
  full_name text not null,
  email text not null,
  phone text,
  role public.user_role not null default 'customer',
  approval_status public.approval_status not null default 'pending',
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null,
  requested_email text not null,
  status public.approval_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  company_id uuid not null references public.companies(id),
  created_by uuid not null references public.profiles(id),
  assigned_agent_id uuid references public.profiles(id),
  assigned_technician_id uuid references public.profiles(id),
  title text not null,
  description text not null,
  status public.ticket_status not null default 'new',
  priority text not null default 'medium',
  location_name text,
  location_lat numeric,
  location_lng numeric,
  wants_callback boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id),
  bucket_name text not null,
  file_path text not null,
  file_type text not null check (file_type in ('photo', 'voice')),
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_status_history (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  old_status public.ticket_status,
  new_status public.ticket_status not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.callback_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  phone text not null,
  status text not null default 'pending',
  completed_by uuid references public.profiles(id),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  category text not null,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  reorder_level integer not null default 5,
  unit_cost numeric(12, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id),
  ticket_id uuid references public.tickets(id),
  technician_id uuid references public.profiles(id),
  movement_type text not null check (movement_type in ('import', 'use', 'adjustment')),
  quantity integer not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  recipient_profile_id uuid references public.profiles(id),
  recipient_email text,
  channel text not null default 'email',
  subject text not null,
  body text not null,
  status public.notification_status not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  record_table text not null,
  record_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_tickets_updated_at on public.tickets;
create trigger set_tickets_updated_at
before update on public.tickets
for each row execute function public.set_updated_at();

drop trigger if exists set_inventory_items_updated_at on public.inventory_items;
create trigger set_inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

create or replace function public.assign_ticket_number()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_number is null or new.ticket_number = '' then
    new.ticket_number :=
      'ABSL-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.ticket_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists assign_ticket_number on public.tickets;
create trigger assign_ticket_number
before insert on public.tickets
for each row execute function public.assign_ticket_number();

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.can_view_ticket(ticket_row public.tickets)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    ticket_row.created_by = auth.uid()
    or ticket_row.assigned_agent_id = auth.uid()
    or ticket_row.assigned_technician_id = auth.uid()
    or public.current_role() in ('agent', 'admin')
$$;

create or replace function public.log_ticket_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_status_history(ticket_id, old_status, new_status, changed_by)
    values (new.id, null, new.status, new.created_by);
  elsif new.status is distinct from old.status then
    insert into public.ticket_status_history(ticket_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists log_ticket_status_insert on public.tickets;
create trigger log_ticket_status_insert
after insert on public.tickets
for each row execute function public.log_ticket_status_change();

drop trigger if exists log_ticket_status_update on public.tickets;
create trigger log_ticket_status_update
after update of status on public.tickets
for each row execute function public.log_ticket_status_change();

create or replace function public.change_ticket_status(
  p_ticket_id uuid,
  p_new_status public.ticket_status,
  p_expected_version integer
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_ticket public.tickets;
begin
  select * into locked_ticket
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if not public.can_view_ticket(locked_ticket) then
    raise exception 'Not allowed';
  end if;

  if locked_ticket.version <> p_expected_version then
    raise exception 'Conflict: ticket was already updated by another user';
  end if;

  update public.tickets
  set status = p_new_status,
      version = version + 1
  where id = p_ticket_id
  returning * into locked_ticket;

  return locked_ticket;
end;
$$;

create or replace function public.consume_inventory(
  p_ticket_id uuid,
  p_inventory_item_id uuid,
  p_quantity integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_quantity integer;
begin
  if p_quantity <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;

  if public.current_role() not in ('technician', 'admin') then
    raise exception 'Only technicians or admins can consume inventory';
  end if;

  select quantity_on_hand into current_quantity
  from public.inventory_items
  where id = p_inventory_item_id
  for update;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  if current_quantity < p_quantity then
    raise exception 'Insufficient stock';
  end if;

  update public.inventory_items
  set quantity_on_hand = quantity_on_hand - p_quantity
  where id = p_inventory_item_id;

  insert into public.inventory_movements (
    inventory_item_id,
    ticket_id,
    technician_id,
    movement_type,
    quantity,
    note
  )
  values (
    p_inventory_item_id,
    p_ticket_id,
    auth.uid(),
    'use',
    -p_quantity,
    'Used from technician Work button'
  );

  return true;
end;
$$;

create or replace function public.queue_ticket_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator_email text;
begin
  select email into creator_email
  from public.profiles
  where id = new.created_by;

  if tg_op = 'INSERT' then
    insert into public.notifications(ticket_id, recipient_profile_id, recipient_email, subject, body)
    values (
      new.id,
      new.created_by,
      creator_email,
      'Ticket created: ' || new.ticket_number,
      'Your support ticket was created successfully.'
    );
  elsif new.status is distinct from old.status then
    insert into public.notifications(ticket_id, recipient_profile_id, recipient_email, subject, body)
    values (
      new.id,
      new.created_by,
      creator_email,
      'Ticket status updated: ' || new.ticket_number,
      'Your ticket status changed to ' || new.status::text || '.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists queue_ticket_notification_insert on public.tickets;
create trigger queue_ticket_notification_insert
after insert on public.tickets
for each row execute function public.queue_ticket_notification();

drop trigger if exists queue_ticket_notification_update on public.tickets;
create trigger queue_ticket_notification_update
after update of status on public.tickets
for each row execute function public.queue_ticket_notification();

alter table public.companies enable row level security;
alter table public.company_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.approval_requests enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_status_history enable row level security;
alter table public.callback_requests enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Companies visible to same company and staff" on public.companies;
create policy "Companies visible to same company and staff"
on public.companies for select
to authenticated
using (
  id in (select company_id from public.profiles where profiles.id = auth.uid())
  or public.current_role() in ('agent', 'admin')
);

drop policy if exists "Admins manage companies" on public.companies;
create policy "Admins manage companies"
on public.companies for all
to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

drop policy if exists "Profiles visible to self and staff" on public.profiles;
create policy "Profiles visible to self and staff"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or public.current_role() in ('agent', 'admin')
);

drop policy if exists "Users update own basic profile" on public.profiles;
create policy "Users update own basic profile"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins manage profiles" on public.profiles;
create policy "Admins manage profiles"
on public.profiles for all
to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

drop policy if exists "Tickets visible by role" on public.tickets;
create policy "Tickets visible by role"
on public.tickets for select
to authenticated
using (public.can_view_ticket(tickets));

drop policy if exists "Approved customers create tickets" on public.tickets;
create policy "Approved customers create tickets"
on public.tickets for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and approval_status = 'approved'
  )
);

drop policy if exists "Staff update tickets" on public.tickets;
create policy "Staff update tickets"
on public.tickets for update
to authenticated
using (
  assigned_agent_id = auth.uid()
  or assigned_technician_id = auth.uid()
  or public.current_role() in ('agent', 'admin')
)
with check (
  assigned_agent_id = auth.uid()
  or assigned_technician_id = auth.uid()
  or public.current_role() in ('agent', 'admin')
);

drop policy if exists "Ticket comments visible with ticket" on public.ticket_comments;
create policy "Ticket comments visible with ticket"
on public.ticket_comments for select
to authenticated
using (
  exists (
    select 1 from public.tickets
    where tickets.id = ticket_comments.ticket_id
      and public.can_view_ticket(tickets)
  )
);

drop policy if exists "Ticket comments insert with ticket" on public.ticket_comments;
create policy "Ticket comments insert with ticket"
on public.ticket_comments for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.tickets
    where tickets.id = ticket_comments.ticket_id
      and public.can_view_ticket(tickets)
  )
);

drop policy if exists "Ticket attachments visible with ticket" on public.ticket_attachments;
create policy "Ticket attachments visible with ticket"
on public.ticket_attachments for select
to authenticated
using (
  exists (
    select 1 from public.tickets
    where tickets.id = ticket_attachments.ticket_id
      and public.can_view_ticket(tickets)
  )
);

drop policy if exists "Ticket attachments insert with ticket" on public.ticket_attachments;
create policy "Ticket attachments insert with ticket"
on public.ticket_attachments for insert
to authenticated
with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.tickets
    where tickets.id = ticket_attachments.ticket_id
      and public.can_view_ticket(tickets)
  )
);

drop policy if exists "Inventory visible to staff" on public.inventory_items;
create policy "Inventory visible to staff"
on public.inventory_items for select
to authenticated
using (public.current_role() in ('agent', 'technician', 'admin'));

drop policy if exists "Admins manage inventory" on public.inventory_items;
create policy "Admins manage inventory"
on public.inventory_items for all
to authenticated
using (public.current_role() = 'admin')
with check (public.current_role() = 'admin');

drop policy if exists "Notifications visible to recipient and admin" on public.notifications;
create policy "Notifications visible to recipient and admin"
on public.notifications for select
to authenticated
using (
  recipient_profile_id = auth.uid()
  or public.current_role() = 'admin'
);

drop policy if exists "Admins read notification attempts" on public.notification_attempts;
create policy "Admins read notification attempts"
on public.notification_attempts for select
to authenticated
using (public.current_role() = 'admin');

insert into public.companies (name, account_limit, status)
values ('Automated Barcode Solutions Pvt Ltd', 25, 'active')
on conflict (name) do nothing;

insert into public.company_domains (company_id, domain, auto_approve)
select id, 'automatedbarcode.net', true
from public.companies
where name = 'Automated Barcode Solutions Pvt Ltd'
on conflict (domain) do update
set company_id = excluded.company_id,
    auto_approve = excluded.auto_approve;

insert into public.inventory_items (sku, name, category, quantity_on_hand, reorder_level, unit_cost)
values
  ('RBN-110-74', 'Wax ribbon 110mm x 74m', 'Ribbon', 24, 5, 1800.00),
  ('LBL-50-25', 'Label roll 50mm x 25mm', 'Labels', 8, 5, 950.00),
  ('HDR-ZD220', 'Print head ZD220', 'Printer Parts', 2, 2, 18500.00)
on conflict (sku) do nothing;
