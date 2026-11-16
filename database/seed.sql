-- Startgegevens: de categorieën en de 6 producten uit data/products.json.
-- Het id van een product = slugify(naam), zelfde als vroeger (de voorraad hangt eraan).

insert into public.categorieen (id, naam, volgorde) values
  ('banden', 'Banden', 1),
  ('electra', 'Electra', 2),
  ('motor', 'Motor', 3),
  ('remmen', 'Remmen', 4),
  ('uitlaat', 'Uitlaat', 5);

insert into public.producten (id, naam, subtitel, prijs, categorie_id, staat, start_voorraad, volgorde) values
  ('cilinder-50cc',   'Cilinder 50cc',   'Honda / Peugeot',    34.95, 'motor',   'Nieuw', 5, 1),
  ('remblokken-voor', 'Remblokken voor', 'Universeel',          9.50, 'remmen',  'Nieuw', 2, 2),
  ('sportuitlaat',    'Sportuitlaat',    'Derbi / Aprilia',    79.00, 'uitlaat', 'Nieuw', 5, 3),
  ('variomatik-kit',  'Variomatik kit',  'Yamaha / Kymco',     22.95, 'motor',   'Nieuw', 5, 4),
  ('luchtfilter',     'Luchtfilter',     'Universeel',          7.50, 'motor',   'Nieuw', 5, 5),
  ('koplamp-led',     'Koplamp LED',     'Peugeot Speedfight', 18.00, 'electra', 'Nieuw', 5, 6);

insert into public.instellingen (sleutel, waarde) values ('lage_voorraad_drempel', '2'::jsonb);
