# PORTI BANK

Banco digital para jogar Banco Imobiliário com os amigos. Cada jogador usa o próprio celular como cartão, sem login. O app vai para a tela inicial com ícone, igual a um aplicativo.

- **Ao vivo:** pagamentos aparecem na hora em todos os celulares.
- **Sem sinal:** o jogo continua. Os lançamentos ficam numa fila no celular e sobem sozinhos quando a internet volta, sem duplicar.
- **Estorno:** qualquer transferência pode ser estornada por quem pagou, quem recebeu ou quem lançou. Logo depois de pagar ainda aparece um botão "Desfazer".
- **Celular descarregou:** toque no nome da pessoa no ranking para pagar, receber ou ajustar o saldo por ela.
- **Banqueiro:** quem abre a mesa vira o banqueiro. Passar pela partida e receber do banco viram pedidos que só o banqueiro aprova. O banco pode ser passado para outro jogador.
- **Calculadora:** na tela de pagar/receber, dados × valor (ex.: 11 × $ 40.000).
- **Quem chega no meio:** entra com o código; o banqueiro pode dar a média da mesa pelo Ajustar.
- Extrato da mesa visível para todos, esconder saldo, sons de maquininha, QR code para chamar a mesa.
- **Entrar pelo QR code:** na tela inicial, "Escanear o QR code da mesa" abre a câmera dentro do app e já entra na sala.
- **Cartas do jogo:** as 28 cartas da edição Mundo com dono, casas e hipoteca. O banqueiro vende as livres; jogadores pedem para comprar e o banqueiro autoriza; donos vendem entre si por um preço combinado. Para construir, é preciso ter a cor inteira sem hipoteca.
- **Tabuleiro 3D:** mostra quem é dono de cada casa (aura e foto), os prédios e onde cada jogador está.
- **Dados:** role no app ou toque no número que saiu na mesa para ver onde vai parar, quanto paga de aluguel e se passou pela partida.
- **Placar:** patrimônio de cada um (saldo + cartas + casas). O banqueiro encerra a partida e todos veem o pódio.

Site: https://losxix.github.io/porti-bank/

## Colocar no ar (uma vez só, uns 15 minutos)

### 1. Banco de dados (Supabase)
1. Entre em [supabase.com](https://supabase.com) e crie um projeto novo chamado `porti-bank` (plano grátis). Use um projeto só dele, não o do Ignite.
2. No menu da esquerda, abra **SQL Editor**, clique em **New query**, cole todo o arquivo `supabase.sql` e clique em **Run**. Deve aparecer **Success**.
3. Clique em **Connect** no topo do projeto (ou **Project Settings → API Keys**) e copie:
   - a **Project URL** (algo como `https://abcd1234.supabase.co`);
   - a chave **anon public** (ou **publishable**).
4. Abra o arquivo `config.js` e cole os dois valores no lugar de `COLE_AQUI...`. Essa chave foi feita para ficar no app: não é senha.

### 2. Site (GitHub Pages)
O site já está publicado em **https://losxix.github.io/porti-bank/** pelo GitHub Pages: cada mudança enviada para a branch `main` vai para o ar sozinha em um ou dois minutos. Depois de uma atualização, feche e abra o app no celular para pegar a versão nova.

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
