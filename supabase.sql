-- ==================================================================
-- PORTI BANK — banco de dados (Supabase)
--
-- Rode isto inteiro no SQL Editor do Supabase. Seguro de rodar de novo:
-- também atualiza um banco que já tinha a versão anterior.
--
-- Como funciona:
--  * Mesas, jogadores e lançamentos ficam em 3 tabelas com prefixo pb_.
--  * Ninguém precisa de login: o app usa a chave pública.
--  * O app só LÊ as tabelas. Toda escrita passa pelas funções abaixo,
--    que conferem os dados. Ninguém apaga nada.
--  * Cada lançamento tem um id criado no celular: reenviar depois de uma
--    queda de internet nunca duplica.
--  * Banqueiro: quem emite o primeiro cartão da mesa. Dinheiro que sai do
--    banco para um jogador (passar pela partida, receber do banco) só vale
--    depois que o banqueiro aprova — a não ser que o próprio banqueiro lance.
--  * Estornar não apaga: marca o lançamento e ele deixa de contar no saldo.
-- ==================================================================

begin;

-- 1) Tabelas ---------------------------------------------------------
create table if not exists public.pb_mesas (
  codigo        text primary key,
  saldo_inicial integer not null,
  salario       integer not null,
  criada_em     timestamptz not null default now(),
  constraint pb_mesas_codigo_ck  check (codigo ~ '^[A-Z0-9]{4}$'),
  constraint pb_mesas_saldo_ck   check (saldo_inicial between 1 and 1000000000),
  constraint pb_mesas_salario_ck check (salario between 0 and 1000000000)
);
alter table public.pb_mesas add column if not exists banqueiro uuid;
alter table public.pb_mesas add column if not exists atualizado_em timestamptz not null default now();

create table if not exists public.pb_jogadores (
  id            uuid primary key,
  mesa          text not null references public.pb_mesas(codigo) on delete cascade,
  nome          text not null,
  cor           text not null,
  oculto        boolean not null default false,
  oculto_em     timestamptz not null default 'epoch',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint pb_jogadores_nome_ck check (char_length(btrim(nome)) between 1 and 20),
  constraint pb_jogadores_cor_ck  check (cor in ('vermelho','azul','verde','amarelo','roxo','preto','laranja','rosa'))
);
create index if not exists pb_jogadores_mesa_idx on public.pb_jogadores (mesa);
alter table public.pb_jogadores add column if not exists removido boolean not null default false;

create table if not exists public.pb_lancamentos (
  id            uuid primary key,
  mesa          text not null references public.pb_mesas(codigo) on delete cascade,
  de            uuid references public.pb_jogadores(id),   -- vazio = Banco
  para          uuid references public.pb_jogadores(id),   -- vazio = Banco
  valor         integer not null,
  motivo        text,
  lancado_por   uuid not null references public.pb_jogadores(id),
  feito_em      timestamptz not null,
  recebido_em   timestamptz not null default now(),
  estornado_em  timestamptz,
  estornado_por uuid references public.pb_jogadores(id),
  atualizado_em timestamptz not null default now(),
  constraint pb_lanc_valor_ck  check (valor between 1 and 1000000000),
  constraint pb_lanc_motivo_ck check (motivo is null or char_length(motivo) <= 40),
  constraint pb_lanc_partes_ck check (de is distinct from para and (de is not null or para is not null))
);
create index if not exists pb_lanc_mesa_idx on public.pb_lancamentos (mesa, atualizado_em);
alter table public.pb_lancamentos add column if not exists status text not null default 'aprovado';
alter table public.pb_lancamentos add column if not exists aprovado_por uuid references public.pb_jogadores(id);
alter table public.pb_lancamentos add column if not exists aprovado_em timestamptz;
alter table public.pb_lancamentos drop constraint if exists pb_lanc_status_ck;
alter table public.pb_lancamentos add constraint pb_lanc_status_ck check (status in ('pendente','aprovado','recusado'));

-- Mesas antigas sem banqueiro: o primeiro jogador vira banqueiro.
update public.pb_mesas m
   set banqueiro = (select j.id from public.pb_jogadores j where j.mesa = m.codigo order by j.criado_em limit 1)
 where m.banqueiro is null;

-- 2) Segurança: todo mundo lê, ninguém escreve direto -----------------
alter table public.pb_mesas       enable row level security;
alter table public.pb_jogadores   enable row level security;
alter table public.pb_lancamentos enable row level security;

revoke insert, update, delete, truncate on public.pb_mesas, public.pb_jogadores, public.pb_lancamentos from anon, authenticated;
grant select on public.pb_mesas, public.pb_jogadores, public.pb_lancamentos to anon, authenticated;

drop policy if exists "pb leitura" on public.pb_mesas;
create policy "pb leitura" on public.pb_mesas for select using (true);
drop policy if exists "pb leitura" on public.pb_jogadores;
create policy "pb leitura" on public.pb_jogadores for select using (true);
drop policy if exists "pb leitura" on public.pb_lancamentos;
create policy "pb leitura" on public.pb_lancamentos for select using (true);

-- 3) Funções que o app chama ------------------------------------------

-- Cria uma mesa com um código de 4 letras que ainda não existe.
create or replace function public.pb_criar_mesa(p_saldo_inicial integer, p_salario integer)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_codigo text;
  v_tentativa integer := 0;
begin
  if p_saldo_inicial is null or p_saldo_inicial < 1 or p_saldo_inicial > 1000000000 then
    raise exception 'Saldo inicial inválido.';
  end if;
  if p_salario is null or p_salario < 0 or p_salario > 1000000000 then
    raise exception 'Valor da partida inválido.';
  end if;
  loop
    v_tentativa := v_tentativa + 1;
    v_codigo := '';
    for i in 1..4 loop
      v_codigo := v_codigo || substr(v_abc, 1 + floor(random() * length(v_abc))::integer, 1);
    end loop;
    begin
      insert into pb_mesas (codigo, saldo_inicial, salario) values (v_codigo, p_saldo_inicial, p_salario);
      return v_codigo;
    exception when unique_violation then
      if v_tentativa > 50 then raise exception 'Não deu para criar a mesa. Tente de novo.'; end if;
    end;
  end loop;
end;
$$;

-- Emite o cartão de um jogador. O primeiro cartão da mesa é o do banqueiro.
create or replace function public.pb_entrar(p_id uuid, p_mesa text, p_nome text, p_cor text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from pb_mesas where codigo = p_mesa for update;
  if not found then
    raise exception 'Mesa não encontrada.';
  end if;
  if not exists (select 1 from pb_jogadores where id = p_id) then
    if (select count(*) from pb_jogadores where mesa = p_mesa) >= 12 then
      raise exception 'Esta mesa já tem 12 jogadores.';
    end if;
    insert into pb_jogadores (id, mesa, nome, cor)
    values (p_id, p_mesa, left(btrim(p_nome), 20), p_cor)
    on conflict (id) do nothing;
  end if;
  update pb_mesas set banqueiro = p_id, atualizado_em = now()
   where codigo = p_mesa and banqueiro is null
     and exists (select 1 from pb_jogadores where id = p_id and mesa = p_mesa);
end;
$$;

-- Registra um lançamento. Dinheiro saindo do banco para um jogador, lançado
-- por quem não é o banqueiro, entra como pedido pendente.
create or replace function public.pb_lancar(
  p_id uuid, p_mesa text, p_de uuid, p_para uuid, p_valor integer,
  p_motivo text, p_por uuid, p_feito_em timestamptz
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_feito timestamptz := least(coalesce(p_feito_em, now()), now() + interval '5 minutes');
  v_banq uuid;
  v_status text := 'aprovado';
begin
  if exists (select 1 from pb_lancamentos where id = p_id) then
    return; -- já registrado (reenvio depois de queda de internet)
  end if;
  if not exists (select 1 from pb_jogadores where id = p_por and mesa = p_mesa) then
    raise exception 'Jogador não encontrado nesta mesa.';
  end if;
  if p_de is not null and not exists (select 1 from pb_jogadores where id = p_de and mesa = p_mesa) then
    raise exception 'Quem paga não está nesta mesa.';
  end if;
  if p_para is not null and not exists (select 1 from pb_jogadores where id = p_para and mesa = p_mesa) then
    raise exception 'Quem recebe não está nesta mesa.';
  end if;
  if (select count(*) from pb_lancamentos where mesa = p_mesa) >= 20000 then
    raise exception 'Esta mesa chegou ao limite de lançamentos. Comece uma nova partida.';
  end if;
  select banqueiro into v_banq from pb_mesas where codigo = p_mesa;
  if p_de is null and p_para is not null and v_banq is not null and p_por <> v_banq then
    v_status := 'pendente';
  end if;
  insert into pb_lancamentos (id, mesa, de, para, valor, motivo, lancado_por, feito_em, status,
                              aprovado_por, aprovado_em)
  values (p_id, p_mesa, p_de, p_para, p_valor, nullif(left(btrim(coalesce(p_motivo, '')), 40), ''), p_por, v_feito, v_status,
          case when v_status = 'aprovado' and p_de is null then p_por end,
          case when v_status = 'aprovado' and p_de is null then now() end)
  on conflict (id) do nothing;
end;
$$;

-- O banqueiro aprova um pedido.
create or replace function public.pb_aprovar(p_id uuid, p_por uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v pb_lancamentos;
begin
  select * into v from pb_lancamentos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v.status <> 'pendente' then return; end if; -- já resolvido (toque duplo ou reenvio)
  if p_por is null or p_por is distinct from (select banqueiro from pb_mesas where codigo = v.mesa) then
    raise exception 'Só o banqueiro pode aprovar.';
  end if;
  update pb_lancamentos
     set status = 'aprovado', aprovado_por = p_por, aprovado_em = now(), atualizado_em = now()
   where id = p_id;
end;
$$;

-- O banqueiro recusa um pedido, ou quem pediu cancela.
create or replace function public.pb_recusar(p_id uuid, p_por uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v pb_lancamentos;
begin
  select * into v from pb_lancamentos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if v.status <> 'pendente' then return; end if;
  if p_por is null or (p_por is distinct from (select banqueiro from pb_mesas where codigo = v.mesa)
                       and p_por is distinct from v.lancado_por and p_por is distinct from v.para) then
    raise exception 'Só o banqueiro ou quem pediu pode cancelar.';
  end if;
  update pb_lancamentos
     set status = 'recusado', aprovado_por = p_por, aprovado_em = now(), atualizado_em = now()
   where id = p_id;
end;
$$;

-- Estorna um lançamento aprovado. Pode: quem pagou, quem recebeu, quem lançou ou o banqueiro.
create or replace function public.pb_estornar(p_id uuid, p_por uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v pb_lancamentos;
begin
  select * into v from pb_lancamentos where id = p_id for update;
  if not found then
    raise exception 'Lançamento não encontrado.';
  end if;
  if v.estornado_em is not null or v.status = 'recusado' then
    return; -- já estornado (toque duplo ou reenvio)
  end if;
  if v.status = 'pendente' then
    perform pb_recusar(p_id, p_por);
    return;
  end if;
  if p_por is null or (p_por is distinct from v.de and p_por is distinct from v.para
                       and p_por is distinct from v.lancado_por
                       and p_por is distinct from (select banqueiro from pb_mesas where codigo = v.mesa)) then
    raise exception 'Só quem pagou, quem recebeu, quem lançou ou o banqueiro pode estornar.';
  end if;
  update pb_lancamentos
     set estornado_em = now(), estornado_por = p_por, atualizado_em = now()
   where id = p_id;
end;
$$;

-- O banqueiro passa o banco para outro jogador da mesa.
create or replace function public.pb_passar_banco(p_mesa text, p_de uuid, p_para uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_banq uuid;
begin
  select banqueiro into v_banq from pb_mesas where codigo = p_mesa for update;
  if not found then raise exception 'Mesa não encontrada.'; end if;
  if v_banq = p_para then return; end if;
  if v_banq is not null and v_banq is distinct from p_de then
    raise exception 'Só o banqueiro pode passar o banco.';
  end if;
  if not exists (select 1 from pb_jogadores where id = p_para and mesa = p_mesa) then
    raise exception 'Jogador não encontrado nesta mesa.';
  end if;
  update pb_mesas set banqueiro = p_para, atualizado_em = now() where codigo = p_mesa;
end;
$$;

-- O banqueiro tira um jogador da mesa (o histórico continua no extrato).
create or replace function public.pb_remover_jogador(p_id uuid, p_por uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_mesa text;
begin
  select mesa into v_mesa from pb_jogadores where id = p_id;
  if not found then raise exception 'Jogador não encontrado.'; end if;
  if p_por is null or p_por is distinct from (select banqueiro from pb_mesas where codigo = v_mesa) then
    raise exception 'Só o banqueiro pode remover jogadores.';
  end if;
  if p_id = p_por then raise exception 'Passe o banco para outra pessoa antes de sair.'; end if;
  update pb_jogadores set removido = true, atualizado_em = now() where id = p_id;
end;
$$;

-- O banqueiro muda o saldo inicial e o valor da partida da mesa.
create or replace function public.pb_mesa_valores(p_mesa text, p_por uuid, p_saldo_inicial integer, p_salario integer)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_por is null or p_por is distinct from (select banqueiro from pb_mesas where codigo = p_mesa) then
    raise exception 'Só o banqueiro pode mudar os valores da mesa.';
  end if;
  if p_saldo_inicial is null or p_saldo_inicial < 1 or p_saldo_inicial > 1000000000 then raise exception 'Saldo inicial inválido.'; end if;
  if p_salario is null or p_salario < 0 or p_salario > 1000000000 then raise exception 'Valor da partida inválido.'; end if;
  update pb_mesas set saldo_inicial = p_saldo_inicial, salario = p_salario, atualizado_em = now() where codigo = p_mesa;
end;
$$;

-- Esconde/mostra o saldo do jogador para a mesa. Vale a mudança mais recente.
create or replace function public.pb_ocultar(p_id uuid, p_oculto boolean, p_quando timestamptz)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update pb_jogadores
     set oculto = coalesce(p_oculto, false),
         oculto_em = least(coalesce(p_quando, now()), now() + interval '5 minutes'),
         atualizado_em = now()
   where id = p_id
     and oculto_em < least(coalesce(p_quando, now()), now() + interval '5 minutes');
end;
$$;

revoke all on function public.pb_criar_mesa(integer, integer) from public;
revoke all on function public.pb_entrar(uuid, text, text, text) from public;
revoke all on function public.pb_lancar(uuid, text, uuid, uuid, integer, text, uuid, timestamptz) from public;
revoke all on function public.pb_aprovar(uuid, uuid) from public;
revoke all on function public.pb_recusar(uuid, uuid) from public;
revoke all on function public.pb_estornar(uuid, uuid) from public;
revoke all on function public.pb_passar_banco(text, uuid, uuid) from public;
revoke all on function public.pb_ocultar(uuid, boolean, timestamptz) from public;
revoke all on function public.pb_remover_jogador(uuid, uuid) from public;
revoke all on function public.pb_mesa_valores(text, uuid, integer, integer) from public;
grant execute on function public.pb_criar_mesa(integer, integer) to anon, authenticated;
grant execute on function public.pb_entrar(uuid, text, text, text) to anon, authenticated;
grant execute on function public.pb_lancar(uuid, text, uuid, uuid, integer, text, uuid, timestamptz) to anon, authenticated;
grant execute on function public.pb_aprovar(uuid, uuid) to anon, authenticated;
grant execute on function public.pb_recusar(uuid, uuid) to anon, authenticated;
grant execute on function public.pb_estornar(uuid, uuid) to anon, authenticated;
grant execute on function public.pb_passar_banco(text, uuid, uuid) to anon, authenticated;
grant execute on function public.pb_ocultar(uuid, boolean, timestamptz) to anon, authenticated;
grant execute on function public.pb_remover_jogador(uuid, uuid) to anon, authenticated;
grant execute on function public.pb_mesa_valores(text, uuid, integer, integer) to anon, authenticated;

-- 4) Tempo real: avisa os celulares na hora -----------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pb_mesas','pb_jogadores','pb_lancamentos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
