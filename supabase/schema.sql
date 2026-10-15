-- Album « L'amour des deux zigs » : stockage Supabase privé + registre des médias.
-- À exécuter une fois dans Supabase → SQL Editor → New query → Run.

-- 1) Bucket PRIVÉ pour les photos et vidéos (aucune lecture publique).
insert into storage.buckets (id, name, public)
values ('souvenirs', 'souvenirs', false)
on conflict (id) do update set public = false;

-- 2) Registre des médias : une ligne n'est ajoutée qu'APRÈS vérification
--    par le serveur que le fichier est bien stocké (route /api/confirmer).
create table if not exists public.souvenirs (
  pathname   text primary key,           -- chemin dans le bucket
  name       text not null,              -- nom affiché
  kind       text not null check (kind in ('image', 'video')),
  size       bigint not null check (size > 0),
  taken_at   timestamptz,                -- date de prise de vue (EXIF) si connue
  created_at timestamptz not null default now()
);

-- 3) Sécurité : RLS activée SANS aucune politique.
--    → les clés publiques (anon / publishable) ne peuvent rien lire ni écrire ;
--    → seul le serveur Vercel, avec la clé secrète, accède aux données.
alter table public.souvenirs enable row level security;
