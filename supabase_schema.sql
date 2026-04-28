create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  book_id uuid not null references public.books(id) on delete cascade,
  transcription text not null,
  page_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books enable row level security;
alter table public.quotes enable row level security;

create policy "books select own" on public.books for select using (auth.uid() = user_id);
create policy "books insert own" on public.books for insert with check (auth.uid() = user_id);
create policy "books update own" on public.books for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "books delete own" on public.books for delete using (auth.uid() = user_id);

create policy "quotes select own" on public.quotes for select using (auth.uid() = user_id);
create policy "quotes insert own" on public.quotes for insert with check (auth.uid() = user_id);
create policy "quotes update own" on public.quotes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "quotes delete own" on public.quotes for delete using (auth.uid() = user_id);

create index if not exists books_user_updated_idx on public.books(user_id, updated_at desc);
create index if not exists quotes_user_book_created_idx on public.quotes(user_id, book_id, created_at desc);
