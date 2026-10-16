# PORTI BANK

Banco digital para jogar Banco Imobiliário com os amigos. Cada jogador usa o próprio celular como cartão, sem login. O app vai para a tela inicial com ícone, igual a um aplicativo.

- **Ao vivo:** pagamentos aparecem na hora em todos os celulares.
- **Sem sinal:** o jogo continua. Os lançamentos ficam numa fila no celular e sobem sozinhos quando a internet volta, sem duplicar.
- **Estorno:** qualquer transferência pode ser estornada por quem pagou, quem recebeu ou quem lançou. Logo depois de pagar ainda aparece um botão "Desfazer".
- **Celular descarregou:** toque no nome da pessoa no ranking para pagar, receber ou ajustar o saldo por ela.
- Esconder saldo, sons de maquininha, QR code para chamar a mesa, botão Ajustar para corrigir saldos.

## Colocar no ar (uma vez só, uns 15 minutos)

### 1. Banco de dados (Supabase)
1. Entre em [supabase.com](https://supabase.com) e crie um projeto novo chamado `porti-bank` (plano grátis). Use um projeto só dele, não o do Ignite.
2. No menu da esquerda, abra **SQL Editor**, clique em **New query**, cole todo o arquivo `supabase.sql` e clique em **Run**. Deve aparecer **Success**.
3. Clique em **Connect** no topo do projeto (ou **Project Settings → API Keys**) e copie:
   - a **Project URL** (algo como `https://abcd1234.supabase.co`);
   - a chave **anon public** (ou **publishable**).
4. Abra o arquivo `config.js` e cole os dois valores no lugar de `COLE_AQUI...`. Essa chave foi feita para ficar no app: não é senha.

### 2. Site (GitHub + Vercel)
1. No GitHub, crie um repositório chamado `porti-bank` e envie todos os arquivos desta pasta (**Add file → Upload files**, arraste tudo, **Commit changes**).
2. Na [Vercel](https://vercel.com), clique em **Add New → Project**, escolha o `porti-bank` e clique em **Deploy**. Não precisa mudar nenhuma configuração.
3. Em um minuto o app fica em `https://porti-bank.vercel.app` (ou um nome parecido que a Vercel mostrar).

### 3. Instalar nos celulares
- **iPhone:** abra o link no **Safari** → botão **Compartilhar** → **Adicionar à Tela de Início**.
- **Android:** abra no **Chrome** → toque em **Instalar** quando aparecer, ou menu **⋮ → Instalar app**.

## Na mesa
1. Um jogador abre o app e toca em **Abrir o banco**. A mesa ganha um código de 4 letras.
2. Ele toca em **Convidar**: os outros leem o QR code ou digitam o código.
3. Cada um emite o próprio cartão e o jogo começa.

## Bom saber
- No plano grátis, o Supabase pode pausar o projeto depois de uns dias sem uso. Se o app disser que está sem sinal mesmo com internet, entre no painel do Supabase e clique em **Restore project**.
- Para entrar numa mesa pela primeira vez (ou criar uma) é preciso internet. Depois disso, o celular joga mesmo sem sinal.
- Os saldos escondidos só somem da tela: quem quiser pode somar o extrato, como no jogo de verdade.
