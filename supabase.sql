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
alter table public.pb_mesas add column if not exists esconder_permitido boolean not null default true;

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
alter table public.pb_jogadores add column if not exists foto text;
alter table public.pb_jogadores add column if not exists situacao text;
alter table public.pb_jogadores drop constraint if exists pb_jogadores_situacao_ck;
alter table public.pb_jogadores add constraint pb_jogadores_situacao_ck check (situacao is null or situacao in ('preso','ferias'));
alter table public.pb_jogadores drop constraint if exists pb_jogadores_foto_ck;
alter table public.pb_jogadores add constraint pb_jogadores_foto_ck check (foto is null or (char_length(foto) <= 30000 and foto ~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$'));

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
  if p_por is distinct from v_banq and exists (select 1 from pb_jogadores where id = p_por and situacao is not null) then
    raise exception 'Você está preso ou de férias: só o banqueiro pode lançar por você agora.';
  end if;
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

-- O banqueiro manda para a cadeia, dá férias ou solta um jogador.
create or replace function public.pb_situacao(p_id uuid, p_por uuid, p_situacao text)
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
    raise exception 'Só o banqueiro pode fazer isso.';
  end if;
  if p_situacao is not null and p_situacao not in ('preso','ferias') then raise exception 'Situação inválida.'; end if;
  update pb_jogadores set situacao = p_situacao, atualizado_em = now() where id = p_id;
end;
$$;

-- O banqueiro decide se os jogadores podem esconder o saldo.
create or replace function public.pb_mesa_esconder(p_mesa text, p_por uuid, p_permitido boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_por is null or p_por is distinct from (select banqueiro from pb_mesas where codigo = p_mesa) then
    raise exception 'Só o banqueiro pode mudar isso.';
  end if;
  update pb_mesas set esconder_permitido = coalesce(p_permitido, true), atualizado_em = now() where codigo = p_mesa;
end;
$$;

-- Foto de perfil (já chega pequena do celular).
create or replace function public.pb_foto(p_id uuid, p_foto text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_foto is not null and (char_length(p_foto) > 30000 or p_foto !~ '^data:image/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'Foto inválida ou grande demais.';
  end if;
  update pb_jogadores set foto = p_foto, atualizado_em = now() where id = p_id;
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
revoke all on function public.pb_foto(uuid, text) from public;
revoke all on function public.pb_mesa_esconder(text, uuid, boolean) from public;
revoke all on function public.pb_situacao(uuid, uuid, text) from public;
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
grant execute on function public.pb_foto(uuid, text) to anon, authenticated;
grant execute on function public.pb_mesa_esconder(text, uuid, boolean) to anon, authenticated;
grant execute on function public.pb_situacao(uuid, uuid, text) to anon, authenticated;
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

-- ==================================================================
-- CARTAS (Títulos de Posse do Banco Imobiliário Mundo)
-- ==================================================================
begin;
create table if not exists public.pb_cartas (
  id     smallint primary key,
  nome   text not null,
  grupo  text not null,
  preco  integer not null,
  casa   integer not null,   -- preço de cada casa (e do condomínio); 0 = ação
  hipoteca integer not null
);
insert into public.pb_cartas (id,nome,grupo,preco,casa,hipoteca) values
  (1,'Cidade do Cabo','verde',60000,50000,50000),
  (2,'Londres','vinho',240000,150000,120000),
  (3,'Berlim','vinho',220000,150000,110000),
  (4,'Paris','vinho',220000,150000,110000),
  (5,'Ottawa','amarelo',260000,150000,150000),
  (6,'Washington','amarelo',260000,150000,150000),
  (7,'Cairo','verde',100000,50000,50000),
  (8,'Luanda','verde',75000,50000,50000),
  (9,'Doha','laranja',320000,200000,160000),
  (10,'Riade','laranja',300000,200000,150000),
  (11,'Abu Dhabi','laranja',300000,200000,150000),
  (12,'Cidade do México','amarelo',280000,150000,140000),
  (13,'Cidade da Guatemala','roxo',100000,50000,50000),
  (14,'Seul','verdeesc',140000,100000,70000),
  (15,'Pequim','verdeesc',160000,100000,80000),
  (16,'Tóquio','verdeesc',140000,100000,70000),
  (17,'Buenos Aires','azul',180000,100000,100000),
  (18,'Camberra','rosa',400000,200000,175000),
  (19,'Wellington','rosa',350000,200000,200000),
  (20,'São José','roxo',120000,50000,60000),
  (21,'OMC','acao',200000,0,100000),
  (22,'ONU','acao',200000,0,100000),
  (23,'Santiago','azul',200000,100000,100000),
  (24,'Montevidéu','azul',180000,100000,100000),
  (25,'OIT','acao',200000,0,100000),
  (26,'OTAN','acao',200000,0,100000),
  (27,'IPCC','acao',150000,0,75000),
  (28,'OMS','acao',150000,0,75000)
on conflict (id) do update set nome=excluded.nome, grupo=excluded.grupo, preco=excluded.preco, casa=excluded.casa, hipoteca=excluded.hipoteca;

create table if not exists public.pb_titulos (
  mesa       text not null references public.pb_mesas(codigo) on delete cascade,
  carta      smallint not null references public.pb_cartas(id),
  dono       uuid references public.pb_jogadores(id),
  casas      smallint not null default 0,   -- 5 = condomínio
  hipotecada boolean not null default false,
  oferta     uuid references public.pb_jogadores(id),  -- banqueiro ofereceu; esperando a pessoa confirmar
  atualizado_em timestamptz not null default now(),
  primary key (mesa, carta),
  constraint pb_tit_casas_ck check (casas between 0 and 5)
);
alter table public.pb_cartas  enable row level security;
alter table public.pb_titulos enable row level security;
revoke insert, update, delete, truncate on public.pb_cartas, public.pb_titulos from anon, authenticated;
grant select on public.pb_cartas, public.pb_titulos to anon, authenticated;
drop policy if exists "pb leitura" on public.pb_cartas;
create policy "pb leitura" on public.pb_cartas for select using (true);
drop policy if exists "pb leitura" on public.pb_titulos;
create policy "pb leitura" on public.pb_titulos for select using (true);

-- Tudo que mexe numa carta passa por aqui. Quando envolve dinheiro, o
-- lançamento é gravado junto (mesmo id = reenvio nunca duplica).
create or replace function public.pb_titulo(p_id uuid, p_mesa text, p_carta integer, p_acao text, p_por uuid, p_para uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  c pb_cartas%rowtype;
  t pb_titulos%rowtype;
  v_banq uuid;
  v_boss boolean;
  v_dono uuid;
begin
  if exists (select 1 from pb_lancamentos where id = p_id) then return; end if;
  select * into c from pb_cartas where id = p_carta;
  if not found then raise exception 'Carta não existe.'; end if;
  if not exists (select 1 from pb_jogadores where id = p_por and mesa = p_mesa and not removido) then
    raise exception 'Jogador não encontrado nesta mesa.';
  end if;
  select banqueiro into v_banq from pb_mesas where codigo = p_mesa;
  v_boss := p_por = v_banq;
  if not v_boss and exists (select 1 from pb_jogadores where id = p_por and situacao is not null) then
    raise exception 'Você está preso ou de férias: só o banqueiro pode mexer agora.';
  end if;
  insert into pb_titulos (mesa, carta) values (p_mesa, p_carta) on conflict do nothing;
  select * into t from pb_titulos where mesa = p_mesa and carta = p_carta for update;

  if p_acao = 'ofertar' then
    if not v_boss then raise exception 'Só o banqueiro vende cartas.'; end if;
    if t.dono is not null then raise exception '% já tem dono.', c.nome; end if;
    if not exists (select 1 from pb_jogadores where id = p_para and mesa = p_mesa and not removido) then raise exception 'Jogador não encontrado.'; end if;
    update pb_titulos set oferta = p_para, atualizado_em = now() where mesa = p_mesa and carta = p_carta;

  elsif p_acao = 'recusar' then
    if not (v_boss or t.oferta = p_por) then raise exception 'Sem permissão.'; end if;
    update pb_titulos set oferta = null, atualizado_em = now() where mesa = p_mesa and carta = p_carta;

  elsif p_acao = 'comprar' then
    v_dono := coalesce(p_para, p_por);
    if t.dono is not null then raise exception '% já tem dono.', c.nome; end if;
    if not (v_boss or (t.oferta = p_por and v_dono = p_por)) then raise exception 'Essa carta não foi oferecida para você.'; end if;
    update pb_titulos set dono = v_dono, oferta = null, casas = 0, hipotecada = false, atualizado_em = now() where mesa = p_mesa and carta = p_carta;
    insert into pb_lancamentos (id, mesa, de, para, valor, motivo, lancado_por, feito_em, status)
    values (p_id, p_mesa, v_dono, null, c.preco, left('Compra: ' || c.nome, 40), p_por, now(), 'aprovado');

  elsif p_acao in ('construir', 'hipotecar', 'resgatar') then
    if t.dono is null then raise exception '% não tem dono.', c.nome; end if;
    if not (v_boss or t.dono = p_por) then raise exception 'Só o dono ou o banqueiro.'; end if;
    if p_acao = 'construir' then
      if c.casa = 0 then raise exception 'Ações não têm casas.'; end if;
      if t.hipotecada then raise exception '% está hipotecada.', c.nome; end if;
      if t.casas >= 5 then raise exception '% já tem condomínio.', c.nome; end if;
      update pb_titulos set casas = casas + 1, atualizado_em = now() where mesa = p_mesa and carta = p_carta;
      insert into pb_lancamentos (id, mesa, de, para, valor, motivo, lancado_por, feito_em, status)
      values (p_id, p_mesa, t.dono, null, c.casa, left(case when t.casas = 4 then 'Condomínio: ' else 'Construção: ' end || c.nome, 40), p_por, now(), 'aprovado');
    elsif p_acao = 'hipotecar' then
      if t.hipotecada then raise exception '% já está hipotecada.', c.nome; end if;
      update pb_titulos set hipotecada = true, atualizado_em = now() where mesa = p_mesa and carta = p_carta;
      insert into pb_lancamentos (id, mesa, de, para, valor, motivo, lancado_por, feito_em, status, aprovado_por, aprovado_em)
      values (p_id, p_mesa, null, t.dono, c.hipoteca, left('Hipoteca: ' || c.nome, 40), p_por, now(), 'aprovado', p_por, now());
    else
      if not t.hipotecada then raise exception '% não está hipotecada.', c.nome; end if;
      update pb_titulos set hipotecada = false, atualizado_em = now() where mesa = p_mesa and carta = p_carta;
      insert into pb_lancamentos (id, mesa, de, para, valor, motivo, lancado_por, feito_em, status)
      values (p_id, p_mesa, t.dono, null, c.hipoteca, left('Fim da hipoteca: ' || c.nome, 40), p_por, now(), 'aprovado');
    end if;

  elsif p_acao = 'tirar_casa' then
    if not v_boss then raise exception 'Só o banqueiro.'; end if;
    update pb_titulos set casas = greatest(casas - 1, 0), atualizado_em = now() where mesa = p_mesa and carta = p_carta;

  elsif p_acao = 'devolver' then
    if not v_boss then raise exception 'Só o banqueiro.'; end if;
    update pb_titulos set dono = null, oferta = null, casas = 0, hipotecada = false, atualizado_em = now() where mesa = p_mesa and carta = p_carta;

  else
    raise exception 'Ação inválida.';
  end if;
end;
$$;
revoke all on function public.pb_titulo(uuid, text, integer, text, uuid, uuid) from public;
grant execute on function public.pb_titulo(uuid, text, integer, text, uuid, uuid) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pb_titulos') then
    alter publication supabase_realtime add table public.pb_titulos;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
