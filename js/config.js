/* Verbinding met de database (Supabase). Dit is de ENIGE plek in de site waar
   het project staat: verhuist de database naar een ander project (bv. het
   account van Jelle), dan pas je alleen deze twee regels aan.

   De sleutel hieronder is de PUBLIEKE sleutel. Die mag in de browser staan:
   de beveiligingsregels in de database (zie database/schema.sql) bepalen wat
   een bezoeker ermee mag, en dat is alleen actieve producten lezen. */
const SUPABASE_URL = 'https://vuscwojadpdyzzgzsofz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U_xHzuA1lU3m9jDMSJ3wvA_AWjaYYdO';
