# Atendimento em Libras

Aplicação enxuta para capturar um sinal pela câmera e apresentar sua interpretação em português.

O fluxo principal contém somente:

- câmera com detecção de mãos;
- captura e interpretação do sinal;
- resultado em português;
- indicação clara quando o serviço não estiver configurado.

## Executar

```bash
npm install
npm run dev
```

Abra `http://localhost:5173` e autorize a câmera.

## Configurar o reconhecimento

Crie `.env` a partir de `.env.example`:

```env
LIBRAS_API_URL=https://seu-provedor.example/translate
LIBRAS_API_STYLE=base64-json
LIBRAS_API_VIDEO_FIELD=video
LIBRAS_API_KEY=coloque-a-chave-no-servidor
LIBRAS_API_KEY_HEADER=Authorization
LIBRAS_API_KEY_PREFIX=Bearer 
```

O servidor mantém a chave fora do navegador e aceita provedor em JSON base64 ou multipart. O resultado esperado deve conter `text` ou `translation`, podendo também informar `confidence`, `modelVersion`, `title` e `sector`.

Sem um serviço configurado, o aplicativo só usa o classificador local calibrado com exemplos rotulados de especialistas. Enquanto essa base não existir, ele não inventa uma tradução nem funciona como tradutor geral de Libras.

## Resposta do atendente em Libras

A tela também possui o fluxo inverso, separado do reconhecimento da câmera: o atendente digita em português e o servidor consulta o VLibras para obter a glosa e, quando disponível, o vídeo sinalizado.

Configure no `.env`:

```env
VLIBRAS_API_BASE_URL=https://traducao2.vlibras.gov.br
VLIBRAS_API_TRANSLATE_METHOD=POST
VLIBRAS_API_TRANSLATE_PATH=/translate
VLIBRAS_API_VIDEO_PATH=/video
VLIBRAS_API_VIDEO_ENABLED=true
VLIBRAS_API_KEY=coloque-a-chave-do-VLibras
VLIBRAS_API_KEY_HEADER=x-api-key
VLIBRAS_API_KEY_PREFIX=
```

O endpoint atual do VLibras recebe `POST /translate` com `{ "text": "..." }`. Se a sua instância exigir autenticação, informe a chave no header `x-api-key`; o servidor faz a intermediação para não expor essa chave no navegador. Se você utilizar uma instância própria, altere apenas a URL e as rotas no `.env`.

O teste agora solicita também a geração do vídeo com `VLIBRAS_API_VIDEO_ENABLED=true`. A rota `/video` pode exigir credenciais próprias; se retornar `Unauthorized`, preencha `VLIBRAS_API_KEY` no `.env` e reinicie o projeto. A glosa continua sendo exibida mesmo quando a geração do vídeo falhar.

## Preparar dados de especialistas

O construtor de dataset fica separado da tela de atendimento. Abra:

```text
http://localhost:5173/?modo=desenvolvimento&dataset=1
```

Ele busca vídeos rotulados de articuladores na base V-Librasil, extrai landmarks e até dez frames de conferência. O dataset exportado está documentado em `DATASET-LIBRAS.md`. A câmera do usuário não é usada como fonte do dataset final.

Use somente sinais e rótulos revisados por alguém fluente em Libras. A playlist do curso serve como referência visual; para incluí-la no dataset, é necessário usar um arquivo local obtido com autorização.

## Escopo atual

O reconhecimento contínuo da câmera (Libras → português) continua dependendo de um serviço de reconhecimento ou de um modelo treinado. A resposta do atendente em português → Libras está preparada para o VLibras por meio das rotas `/api/vlibras/translate` e `/api/vlibras/video`.
