# Estrutura do dataset de Libras

O construtor de dataset fica disponível no endereço `?modo=desenvolvimento&dataset=1`. A fonte principal é a base pública V-Librasil, formada por vídeos isolados e rotulados de articuladores. Também é possível usar um arquivo local autorizado quando uma fonte de referência ainda não estiver disponível. A câmera do usuário não é usada para montar o dataset final.

Cada exemplo exportado segue esta estrutura:

```json
{
  "id": "identificador-do-exemplo",
  "label": "numero-quatro",
  "featureVersion": "hands-normalized-v1",
  "source": "expert-dataset",
  "sourceReference": "V-Librasil — quatro — articulador-01",
  "expertDataset": "V-Librasil",
  "expertClass": "quatro",
  "expertArticulator": "articulador-01",
  "expertVideoUrl": "https://huggingface.co/datasets/ibmectech/v-librasil-raw/resolve/main/videos/Quatro_Articulador1.mp4",
  "expertOriginalVideoUrl": "https://libras.cin.ufpe.br/storage/videos/exemplo.mp4",
  "courseLessonNumber": 11,
  "courseLessonTitle": "Números",
  "courseLessonUrl": "https://www.youtube.com/watch?v=zZ4l3ko-kSU&list=PL8vXuI6zmpdjRWqlbPUY5ASgO-ovJd0sf&index=11",
  "startTime": 12.4,
  "endTime": 14.8,
  "sampleRate": 10,
  "createdAt": "2026-09-09T12:00:00.000Z",
  "sequence": [
    {
      "version": "hands-normalized-v1",
      "vector": [0.0],
      "handShapes": {
        "left": null,
        "right": {
          "fingerCount": 4,
          "palmOpen": true,
          "fingers": [false, true, true, true, true],
          "wrist": { "x": 0.5, "y": 0.4, "z": 0.0 }
        }
      },
      "hands": 1,
      "timestamp": 123456.7
    }
  ],
  "frameSnapshots": [
    {
      "time": 12.4,
      "mimeType": "image/jpeg",
      "image": "data:image/jpeg;base64,..."
    }
  ]
}
```

`sequence` é usada pelo classificador local. `frameSnapshots` são imagens reduzidas de conferência, limitadas a dez por trecho para não lotar o armazenamento do navegador. O botão de exportação baixa o conjunto em JSON, preservando as duas camadas.

O construtor consulta as anotações da base [V-Librasil](https://huggingface.co/datasets/ibmectech/v-librasil-raw), procura uma classe compatível com o sinal escolhido e oferece variações por articulador. Ao extrair o trecho, salva os landmarks e até dez imagens de conferência no navegador. O rótulo vem da anotação da base, e não de uma suposição feita pelo usuário.

A playlist do curso de Libras continua registrada como material didático e de validação visual. Ela é útil para conferir execução, contexto e variações, mas não é automaticamente transformada em dataset porque os vídeos do YouTube não vêm com uma marcação temporal confiável de cada sinal e a página não entrega o arquivo bruto ao detector do navegador. Para usar uma aula específica no dataset, é necessário obter um arquivo local autorizado e associar manualmente o intervalo e o rótulo.

Para cada sinal, devem ser coletados vários exemplos: articuladores diferentes, mão direita e esquerda, distância e iluminação variadas. Os rótulos precisam ser revisados por alguém fluente em Libras antes de usar o dataset em produção. A V-Librasil é adequada para iniciar o desenvolvimento, mas seus termos de uso devem ser conferidos antes de qualquer uso comercial.
