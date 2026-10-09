# Pesquisa de tecnologias para Libras

Pesquisa realizada em outubro de 2026. A conclusão prática é separar detecção, reconhecimento de sinais isolados e tradução linguística.

## O que existe no projeto

- React/Vite captura vídeo e MediaPipe Web encontra até duas mãos.
- Sem `LIBRAS_API_URL`, não existe provedor de tradução de vídeo.
- O classificador JavaScript anterior compara exemplos da `localStorage`; um navegador novo não tem exemplos.
- O modo do alfabeto usa regras de pose escritas à mão e não reconhece palavras ou sinais em movimento.

Por isso a tela podia mostrar a câmera e os pontos das mãos sem produzir tradução. O novo caminho Python aceita landmarks e só entra em operação depois do treino de um conjunto rotulado.

## Bibliotecas e dados avaliados

| Tecnologia | Uso adequado neste projeto | Limite ou decisão |
| --- | --- | --- |
| [scikit-learn](https://scikit-learn.org/stable/) | Pipeline local inicial para normalizar sequências e classificar sinais isolados com KNN ponderado. | Não cria dados de treino; o escore de votos não é probabilidade calibrada. |
| [MediaPipe Holistic Landmarker](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/holistic_landmarker) | Próxima evolução da captura: mãos, pose e landmarks faciais em uma só sequência. | A versão atual do app usa somente mãos; será preciso mudar a representação e coletar novamente os exemplos. |
| [Sign Language Datasets](https://github.com/sign-language-processing/datasets) | Ferramentas Python/TFDS e formatos de vídeo, gloss e pose para pesquisa com corpora. | A lista de loaders documentada não inclui V-Librasil; não fornece um modelo Libras pronto. |
| [V-Librasil](https://huggingface.co/datasets/ibmectech/v-librasil-raw) | Base pública de vídeos de sinais isolados já usada pelo construtor do projeto. | Rótulos de sinais isolados não constituem frases traduzidas automaticamente; confira termos e representatividade antes de uso comercial. |
| [LibraSign](https://github.com/Heitorccf/librasign) | Referência em Python para alfabeto manual estático e treino com landmarks. | Escopo A–Z; não é tradução de frases. O repositório é GPL-3.0 e seu dataset público tem licença própria a verificar; o código não foi copiado para este projeto. |

O artigo sobre V-Librasil descreve 4.089 vídeos para 1.364 sinais, geralmente com três pessoas por sinal. Um experimento que concatena vídeos de sinais isolados para produzir sentenças reporta BLEU-4 de 9,2 e METEOR de 26,2, o que demonstra pesquisa promissora, mas também a diferença entre reconhecer sinais e traduzir uma frase natural ([artigo](https://arxiv.org/abs/2409.01506)).

## Implementação atual em Python

O projeto agora inclui um serviço local em Python e um treinador baseado em scikit-learn. O navegador envia somente landmarks ao servidor local; o vídeo não é encaminhado ao classificador Python. Para iniciar:

```bash
npm run setup:python
npm run dev
```

Colete e exporte pelo menos três exemplos de cada sinal, depois treine:

```bash
.venv/bin/python python/train.py ~/Downloads/libras-dataset-AAAA-MM-DD.json
```

O treinador mede acurácia e F1 macro, tenta separar articuladores na validação e grava um modelo local. A API recarrega o arquivo quando ele muda. Isso habilita um vocabulário fechado, não uma tradução geral.

## Próximas etapas técnicas

1. Trocar a detecção só de mãos por Holistic Landmarker e incluir orientação do tronco e marcadores faciais relevantes, preservando consentimento e privacidade.
2. Aumentar exemplos por sinal e por pessoa; manter conjuntos de teste separados por articulador para medir generalização.
3. Para frases, treinar e avaliar uma arquitetura temporal (por exemplo, PyTorch) em corpus de Libras com glossas e traduções. Não usar somente alfabeto manual ou loaders de ASL para afirmar tradução de Libras.
4. Validar saídas com pessoas surdas e fluentes em Libras antes de usar em atendimento.

Python 3.14 é compatível com os wheels atuais de scikit-learn 1.9.1 e MediaPipe 1.1.0 publicados no PyPI na data da pesquisa. O primeiro treinador precisa somente de scikit-learn e joblib; MediaPipe continua no navegador neste estágio ([scikit-learn/PyPI](https://pypi.org/project/scikit-learn/), [MediaPipe/PyPI](https://pypi.org/project/mediapipe/)).
