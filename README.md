# PDF OCR

Aplicacao web para localizar paginas impressas dentro de arquivos PDF. O projeto faz a leitura da numeracao com OCR, cria um mapa entre a pagina impressa e a pagina real do PDF e permite abrir rapidamente a pagina correta.

## Funcionalidades

- Upload de arquivo PDF no navegador.
- Leitura OCR com `tesseract.js`.
- Renderizacao de paginas com `pdfjs-dist`.
- Mapeamento automatico da paginacao.
- Configuracao manual de uma ou mais areas de OCR.
- Busca pela pagina impressa com preview da pagina encontrada.

## Stack

- React 19
- TypeScript
- Vite
- `pdfjs-dist`
- `tesseract.js`

## Como usar

1. Abra a aplicacao.
2. Envie um arquivo `.pdf`.
3. Ajuste a area onde a numeracao aparece, se necessario.
4. Execute o mapeamento automatico ou a leitura das areas configuradas.
5. Digite o numero da pagina impressa para localizar a pagina correspondente no PDF.

## Scripts

```bash
npm install
npm run dev
npm run lint
```

## Observacoes

- O processamento acontece no navegador.
- O OCR funciona melhor quando a numeracao da pagina esta legivel e bem definida.
- Hoje o fluxo foi pensado para um PDF por vez.
