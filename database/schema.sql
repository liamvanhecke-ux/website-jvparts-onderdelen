-- JV Parts: tabellen, beveiliging (RLS), opslag voor foto's en views voor het dashboard.
-- Eén keer uitvoeren in een LEEG Supabase-project (SQL-editor). Daarna database/seed.sql.

-- 1. Tabellen ---------------------------------------------------------------

create table public.categorieen (
  id        text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  naam      text not null,
  naam_fr   text,
  naam_de   text,
  volgorde  int  not null default 0
);

create table public.producten (
  id              text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  naam            text not null,
  naam_fr         text,
  naam_de         text,
  subtitel        text,
  subtitel_fr     text,
  subtitel_de     text,
  prijs           numeric(10,2) not null check (prijs >= 0),
  categorie_id    text references public.categorieen(id) on update cascade on delete set null,
  staat           text not null default 'Nieuw' check (staat in ('Nieuw', 'Tweedehands')),
  start_voorraad  int check (start_voorraad is null or start_voorraad >= 0),
  foto_pad        text,
  beschrijving    text,
  beschrijving_fr text,
  beschrijving_de text,
  volgorde        int  not null default 0,
  actief          boolean not null default true,
  aangemaakt      timestamptz not null default now(),
  bijgewerkt      timestamptz not null default now()
);
create index producten_categorie_idx on public.producten (categorie_id);

create table public.beheerders (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  toegevoegd timestamptz not null default now()
);

create table public.bestellingen (
  id            text primary key,          -- de Stripe-sessie (cs_...), voorkomt dubbels
  betaald_op    timestamptz not null,
  totaal        numeric(10,2) not null check (totaal >= 0),
  verzendkost   numeric(10,2) not null default 0,
  verzendwijze  text,
  klant_naam    text,
  klant_email   text,
  klant_adres   text,
  klant_land    text,
  taal          text
);
create index bestellingen_betaald_op_idx on public.bestellingen (betaald_op desc);

create table public.bestelregels (
  id            bigint generated always as identity primary key,
  bestelling_id text not null references public.bestellingen(id) on delete cascade,
  product_id    text,                      -- geen FK: een product kan later verwijderd worden
  product_naam  text not null,             -- naam op het moment van de aankoop
  aantal        int  not null check (aantal > 0),
  stukprijs     numeric(10,2) not null check (stukprijs >= 0)
);
create index bestelregels_bestelling_idx on public.bestelregels (bestelling_id);
create index bestelregels_product_idx on public.bestelregels (product_id);

create table public.instellingen (
  sleutel text primary key,
  waarde  jsonb not null
);

-- 2. Hulpfuncties -----------------------------------------------------------

-- Is de ingelogde gebruiker een beheerder? (staat hij in de tabel beheerders)
create function public.is_beheerder()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.beheerders b where b.user_id = (select auth.uid()));
$$;

create function public.zet_bijgewerkt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.bijgewerkt := now();
  return new;
end;
$$;

create trigger producten_bijgewerkt
before update on public.producten
for each row execute function public.zet_bijgewerkt();

-- 3. Beveiliging: Row Level Security ----------------------------------------
-- anon = een bezoeker zonder login, authenticated = iemand die ingelogd is.

alter table public.categorieen  enable row level security;
alter table public.producten    enable row level security;
alter table public.beheerders   enable row level security;
alter table public.bestellingen enable row level security;
alter table public.bestelregels enable row level security;
alter table public.instellingen enable row level security;

revoke all on public.categorieen, public.producten, public.beheerders,
              public.bestellingen, public.bestelregels, public.instellingen
  from anon, authenticated;

grant select on public.categorieen, public.producten to anon, authenticated;
grant insert, update, delete on public.categorieen, public.producten to authenticated;
grant select on public.beheerders, public.bestellingen, public.bestelregels to authenticated;
grant select, insert, update, delete on public.instellingen to authenticated;

-- beheerders: je ziet alleen je eigen rij; toevoegen kan alleen via het dashboard / SQL
create policy "eigen rij lezen" on public.beheerders
  for select to authenticated using (user_id = (select auth.uid()));

-- categorieen: iedereen leest, alleen beheerders schrijven
create policy "iedereen leest categorieen" on public.categorieen
  for select to anon, authenticated using (true);
create policy "beheerder voegt categorie toe" on public.categorieen
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "beheerder wijzigt categorie" on public.categorieen
  for update to authenticated using ((select public.is_beheerder())) with check ((select public.is_beheerder()));
create policy "beheerder verwijdert categorie" on public.categorieen
  for delete to authenticated using ((select public.is_beheerder()));

-- producten: bezoekers zien alleen actieve producten, beheerders alles
create policy "bezoekers lezen actieve producten" on public.producten
  for select to anon using (actief);
create policy "ingelogd leest actieve of alles als beheerder" on public.producten
  for select to authenticated using (actief or (select public.is_beheerder()));
create policy "beheerder voegt product toe" on public.producten
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "beheerder wijzigt product" on public.producten
  for update to authenticated using ((select public.is_beheerder())) with check ((select public.is_beheerder()));
create policy "beheerder verwijdert product" on public.producten
  for delete to authenticated using ((select public.is_beheerder()));

-- bestellingen en bestelregels: persoonsgegevens, alleen beheerders lezen.
-- Schrijven gebeurt alleen door de server (service-sleutel, die RLS omzeilt).
create policy "beheerder leest bestellingen" on public.bestellingen
  for select to authenticated using ((select public.is_beheerder()));
create policy "beheerder leest bestelregels" on public.bestelregels
  for select to authenticated using ((select public.is_beheerder()));

-- instellingen: alleen beheerders
create policy "beheerder leest instellingen" on public.instellingen
  for select to authenticated using ((select public.is_beheerder()));
create policy "beheerder voegt instelling toe" on public.instellingen
  for insert to authenticated with check ((select public.is_beheerder()));
create policy "beheerder wijzigt instelling" on public.instellingen
  for update to authenticated using ((select public.is_beheerder())) with check ((select public.is_beheerder()));
create policy "beheerder verwijdert instelling" on public.instellingen
  for delete to authenticated using ((select public.is_beheerder()));

-- 4. Views voor het dashboard ------------------------------------------------
-- security_invoker: de beveiliging van de tabellen eronder blijft gelden.

create view public.omzet_per_dag
with (security_invoker = true) as
select (betaald_op at time zone 'Europe/Brussels')::date as dag,
       count(*)::int                                     as aantal_bestellingen,
       sum(totaal)                                       as omzet
from public.bestellingen
group by 1;

create view public.verkocht_per_product
with (security_invoker = true) as
select product_id,
       max(product_naam)        as product_naam,
       sum(aantal)::int         as aantal_verkocht,
       sum(aantal * stukprijs)  as omzet
from public.bestelregels
group by product_id;

revoke all on public.omzet_per_dag, public.verkocht_per_product from anon, authenticated;
grant select on public.omzet_per_dag, public.verkocht_per_product to authenticated;

-- 5. Opslag voor productfoto's ----------------------------------------------
-- Publieke bucket: iedereen kan een foto openen via zijn adres, alleen beheerders kunnen opladen.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('productfotos', 'productfotos', true, 2097152, array['image/jpeg', 'image/webp', 'image/png']);

create policy "beheerder laadt foto op" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productfotos' and (select public.is_beheerder()));
create policy "beheerder vervangt foto" on storage.objects
  for update to authenticated
  using (bucket_id = 'productfotos' and (select public.is_beheerder()))
  with check (bucket_id = 'productfotos' and (select public.is_beheerder()));
create policy "beheerder verwijdert foto" on storage.objects
  for delete to authenticated
  using (bucket_id = 'productfotos' and (select public.is_beheerder()));
create policy "beheerder ziet fotolijst" on storage.objects
  for select to authenticated
  using (bucket_id = 'productfotos' and (select public.is_beheerder()));

-- 6. Een beheerder toevoegen (na het aanmaken van de gebruiker in Authentication > Users):
--    insert into public.beheerders (user_id)
--    select id from auth.users where email = 'het-adres@van-de-beheerder.be';
