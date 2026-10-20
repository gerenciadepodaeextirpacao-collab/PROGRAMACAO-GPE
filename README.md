# Programação GPE

App de campo da **Gerência de Poda e Extirpação – DIRSEN (COMURG)**.
Desenvolvido por **Victor Ricardo Porto Alcântara**.

## O que o app faz

- **Programar** — supervisores lançam a programação da turma (por supervisão), com bloqueio de endereço em duplicidade.
- **Baixas** — baixa da execução: executado, executado parcialmente ou não executado (com remarcação e serviço feito no lugar).
- **Quedas** — registro de galho e árvore caída (atendimento imediato) e do impacto na programação do dia.
- **Lista** — consulta de todos os lançamentos (só visualização).
- **Painel** — dashboard com receita, cumprimento, contrato mensal, execução por dia, turmas, motivos e quedas.
- Relatório com gráficos (PDF/HTML) e planilha Excel formatada.
- Login por matrícula e senha, com perfis: diretoria, gerente, gerência, coordenador, supervisor e fiscal.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `index.html` | O app completo (HTML, CSS e JavaScript num único arquivo). |
| `README.md` | Este texto. |

## Importante: onde os dados ficam

O app foi construído para rodar como **artifact do Claude** (claude.ai). Os dados (lançamentos e usuários)
ficam no banco de dados do próprio artifact, acessado pelo objeto `window.claude` (recursos `db`, `user` e `downloads`).

Fora do Claude — por exemplo, aberto direto do GitHub Pages — **o layout abre, mas não há banco de dados**:
não dá para entrar, programar nem dar baixa. Este repositório serve como **cópia de segurança e controle de versões do código**.

Para o app funcionar hospedado fora do Claude, é preciso trocar a camada de dados (função de início, no fim do
`index.html`, que chama `window.claude.use("db")`) por um banco próprio — por exemplo Firebase/Firestore ou Supabase —
com a mesma estrutura:

- coleção `lancamentos` — um documento por serviço (programação, baixa, remarcação, queda);
- documento `cfg/acesso` — `{ usuarios: { id: { nome, matricula, perfil, sup, salt, hash, ativo } } }`
  (senha guardada como SHA-256 de `salt:senha`).

## Publicar no GitHub

1. Crie um repositório (de preferência **privado**) em github.com → **New repository**.
2. Clique em **Add file → Upload files** e envie `index.html` e `README.md`.
3. Clique em **Commit changes**.

Para atualizar depois, envie o novo `index.html` da mesma forma; o GitHub guarda o histórico de cada versão.
