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

O projeto também tem um classificador local em Python. Para preparar o ambiente isolado uma vez:

```bash
npm run setup:python
npm run dev
```

Sem o ambiente Python, o site e a detecção de mãos continuam abrindo; o reconhecimento local permanece indisponível até haver um modelo treinado.

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

O aplicativo pode usar uma API externa de reconhecimento ou o serviço local Python. O serviço Python classifica sequências de landmarks com scikit-learn e não envia vídeo pela rede local. Ele só fica pronto depois de treinar com exemplos rotulados. A detecção de mãos do MediaPipe, sozinha, não traduz Libras.

### Treinar o modelo local Python

1. Abra “Preparar modelo Python” na tela inicial.
2. Para cada sinal, extraia pelo menos três exemplos com rótulos revisados; use pessoas diferentes quando possível.
3. Exporte o dataset para JSON.
4. Treine o modelo (macOS/Linux):

   ```bash
   .venv/bin/python python/train.py ~/Downloads/libras-dataset-AAAA-MM-DD.json
   ```

   No Windows, use `.venv\\Scripts\\python.exe` no lugar de `.venv/bin/python`.

O treinamento grava `python/models/libras-knn.joblib`. O serviço percebe o arquivo novo e a tela atualiza o estado ao ativar a câmera. O relatório inclui acurácia e F1 macro em uma separação de validação; se houver exemplos de pelo menos dois articuladores por sinal, tenta manter pessoas diferentes entre treino e validação. O escore do KNN é uma proporção de votos, não uma probabilidade calibrada. O modelo reconhece somente as classes presentes no dataset e não deve ser tratado como tradutor geral nem usado sem revisão de uma pessoa fluente em Libras.

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

## Soletrar do alfabeto manual para texto

Abra `http://localhost:5173/?modo=alfabeto` para soletrar letras do alfabeto manual em um campo de texto. Cada pose estática é comparada com uma tabela heurística e adicionada quando fica estável; os controles permitem inserir espaços, apagar e copiar o texto. O detector e a comparação rodam no navegador, sem gravar ou enviar o vídeo.

Este recurso é experimental: as assinaturas foram escritas à mão e não foram validadas com uma base representativa. Ele soletra letras; não traduz sinais lexicais, gramática ou frases. Letras que dependem de movimento não podem ser distinguidas apenas pela pose. Não use os palpites para atendimento ou avaliação de proficiência.

## Escopo atual

O modelo Python inicial é um classificador de vocabulário limitado para sequências isoladas. Ainda não modela expressões faciais, postura do corpo ou a gramática espacial da Libras. A resposta do atendente em português → Libras está preparada para o VLibras por meio das rotas `/api/vlibras/translate` e `/api/vlibras/video`. Leia [a pesquisa de tecnologias e próximos passos](./PESQUISA-TECNOLOGIAS-LIBRAS.md).
