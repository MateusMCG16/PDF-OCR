import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as Tesseract from 'tesseract.js'
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url'
import './OcrWorkspace.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const OCR_RENDER_SCALE = 2
const PREVIEW_RENDER_SCALE = 1.35
const CONFIG_RENDER_SCALE = 1.15
const MIN_SELECTION_SIZE = 0.025

type ScanState = 'idle' | 'ready' | 'scanning' | 'scanned' | 'error'

type PageMapping = {
  printedPage: string
  pdfPageNumber: number
  confidence?: number
}

type SearchResult = {
  printedPage: string
  pdfPageNumber: number
  previewUrl: string
}

type OcrSelection = {
  x: number
  y: number
  width: number
  height: number
}

type OcrCandidate = {
  printedPage: string
  confidence?: number
}

type AutoOcrRegion = {
  name: string
  selection: OcrSelection
  weight: number
  preferredNumber: 'first' | 'last' | 'any'
}

type AutoOcrCandidate = OcrCandidate & {
  value: number
  score: number
}

type LoadedBook = {
  fileName: string
  document: PDFDocumentProxy
  pageCount: number
}

type ScanProgress = {
  currentPage: number
  totalPages: number
  ocrStatus: string
  ocrProgress: number
}

type DragState = {
  startX: number
  startY: number
}

const initialProgress: ScanProgress = {
  currentPage: 0,
  totalPages: 0,
  ocrStatus: '',
  ocrProgress: 0,
}

const initialOcrSelection: OcrSelection = {
  x: 0.74,
  y: 0.02,
  width: 0.2,
  height: 0.12,
}

const initialOcrSelections = [initialOcrSelection]

const autoOcrRegions: AutoOcrRegion[] = [
  {
    name: 'top-left',
    selection: { x: 0.035, y: 0.018, width: 0.45, height: 0.09 },
    weight: 22,
    preferredNumber: 'first',
  },
  {
    name: 'top-right',
    selection: { x: 0.52, y: 0.018, width: 0.445, height: 0.09 },
    weight: 22,
    preferredNumber: 'last',
  },
  {
    name: 'bottom-left',
    selection: { x: 0.035, y: 0.89, width: 0.32, height: 0.09 },
    weight: 12,
    preferredNumber: 'first',
  },
  {
    name: 'bottom-right',
    selection: { x: 0.645, y: 0.89, width: 0.32, height: 0.09 },
    weight: 12,
    preferredNumber: 'last',
  },
]

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum)
}

function formatError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Nao foi possivel concluir a leitura deste PDF.'
}

function normalizePageNumber(value: string) {
  const trimmed = value.trim()

  if (!/^\d+$/.test(trimmed)) {
    return ''
  }

  return String(Number.parseInt(trimmed, 10))
}

function extractPrintedPage(text: string) {
  const matches = text.match(/\d+/g)
  const lastMatch = matches?.at(-1)

  return lastMatch ? normalizePageNumber(lastMatch) : ''
}

function extractPrintedPageCandidates(text: string) {
  const matches = text.match(/\d+/g) ?? []

  return matches.map(normalizePageNumber).filter(Boolean)
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { alpha: false })

  if (!context) {
    throw new Error('O navegador nao liberou o canvas para renderizar a pagina.')
  }

  return context
}

async function renderPageToCanvas(page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')

  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)

  await page.render({
    canvas,
    canvasContext: getCanvasContext(canvas),
    viewport,
  }).promise

  return canvas
}

function cropOcrSelection(source: HTMLCanvasElement, selection: OcrSelection) {
  const sourceX = Math.floor(source.width * selection.x)
  const sourceY = Math.floor(source.height * selection.y)
  const width = Math.max(1, Math.floor(source.width * selection.width))
  const height = Math.max(1, Math.floor(source.height * selection.height))
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height
  getCanvasContext(canvas).drawImage(
    source,
    sourceX,
    sourceY,
    width,
    height,
    0,
    0,
    width,
    height,
  )

  return canvas
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

function selectionFromDrag(startX: number, startY: number, currentX: number, currentY: number) {
  const x = Math.min(startX, currentX)
  const y = Math.min(startY, currentY)
  const width = clamp(Math.abs(currentX - startX), MIN_SELECTION_SIZE)
  const height = clamp(Math.abs(currentY - startY), MIN_SELECTION_SIZE)

  return {
    x: clamp(x, 0, 1 - width),
    y: clamp(y, 0, 1 - height),
    width,
    height,
  }
}

function mirrorSelection(selection: OcrSelection) {
  return {
    ...selection,
    x: clamp(1 - selection.x - selection.width, 0, 1 - selection.width),
  }
}

function selectionStyle(selection: OcrSelection) {
  return {
    '--selection-x': `${selection.x * 100}%`,
    '--selection-y': `${selection.y * 100}%`,
    '--selection-width': `${selection.width * 100}%`,
    '--selection-height': `${selection.height * 100}%`,
  } as CSSProperties
}

function printedPageValue(candidate: OcrCandidate) {
  return Number.parseInt(candidate.printedPage, 10)
}

function choosePrintedPageCandidate(
  candidates: OcrCandidate[],
  previousPrintedPage: number | null,
) {
  if (candidates.length === 0) {
    return null
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.printedPage, candidate])).values(),
  )

  if (previousPrintedPage !== null) {
    const expected = uniqueCandidates.find(
      (candidate) => printedPageValue(candidate) === previousPrintedPage + 1,
    )

    if (expected) {
      return expected
    }

    const nextAscending = [...uniqueCandidates]
      .filter((candidate) => printedPageValue(candidate) > previousPrintedPage)
      .sort((first, second) => printedPageValue(first) - printedPageValue(second))[0]

    return nextAscending ?? null
  }

  return [...uniqueCandidates].sort(
    (first, second) => (second.confidence ?? 0) - (first.confidence ?? 0),
  )[0]
}

function autoCandidatesFromText(
  text: string,
  confidence: number | undefined,
  region: AutoOcrRegion,
  pdfPageNumber: number,
) {
  const printedPages = extractPrintedPageCandidates(text)

  return printedPages
    .map((printedPage, index) => {
      const value = Number.parseInt(printedPage, 10)
      const isPreferredFirst = region.preferredNumber === 'first' && index === 0
      const isPreferredLast =
        region.preferredNumber === 'last' && index === printedPages.length - 1
      const ordinalScore = isPreferredFirst || isPreferredLast ? 18 : 0
      const pageDistance = Math.abs(value - pdfPageNumber)
      const pageClosenessScore = Math.max(0, 10 - pageDistance)

      return {
        printedPage,
        confidence,
        value,
        score: (confidence ?? 0) + region.weight + ordinalScore + pageClosenessScore,
      }
    })
    .filter((candidate) => Number.isFinite(candidate.value) && candidate.value > 0)
}

function chooseAutomaticPrintedPageCandidate(
  candidates: AutoOcrCandidate[],
  previousPrintedPage: number | null,
  pdfPageNumber: number,
) {
  if (candidates.length === 0) {
    return null
  }

  const uniqueCandidates = Array.from(
    candidates
      .reduce((byPage, candidate) => {
        const current = byPage.get(candidate.printedPage)

        if (!current || candidate.score > current.score) {
          byPage.set(candidate.printedPage, candidate)
        }

        return byPage
      }, new Map<string, AutoOcrCandidate>())
      .values(),
  )

  if (previousPrintedPage !== null) {
    const expected = uniqueCandidates
      .filter((candidate) => candidate.value === previousPrintedPage + 1)
      .sort((first, second) => second.score - first.score)[0]

    if (expected) {
      return expected
    }

    const nearbyNext = uniqueCandidates
      .filter(
        (candidate) =>
          candidate.value > previousPrintedPage && candidate.value <= previousPrintedPage + 5,
      )
      .sort((first, second) => first.value - second.value || second.score - first.score)[0]

    if (nearbyNext) {
      return nearbyNext
    }
  }

  return uniqueCandidates
    .filter((candidate) => candidate.value <= Math.max(pdfPageNumber + 20, 50))
    .sort((first, second) => second.score - first.score)[0] ?? null
}

function OcrWorkspace() {
  const [book, setBook] = useState<LoadedBook | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [pageMap, setPageMap] = useState(() => new Map<string, PageMapping>())
  const [progress, setProgress] = useState(initialProgress)
  const [query, setQuery] = useState('')
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [ocrSelections, setOcrSelections] = useState<OcrSelection[]>(initialOcrSelections)
  const [activeSelectionIndex, setActiveSelectionIndex] = useState(0)
  const [configPageNumber, setConfigPageNumber] = useState(1)
  const [configPreviewUrl, setConfigPreviewUrl] = useState('')
  const [isConfigPreviewLoading, setIsConfigPreviewLoading] = useState(false)
  const documentRef = useRef<PDFDocumentProxy | null>(null)
  const selectorRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const configPreviewRequestRef = useRef(0)

  useEffect(() => {
    return () => {
      void documentRef.current?.destroy()
    }
  }, [])

  const resetScanOutput = useCallback(() => {
    setPageMap(new Map())
    setProgress(initialProgress)
    setQuery('')
    setSearchResult(null)
    setError('')
    setIsSearching(false)
  }, [])

  const resetScanAfterOcrConfigChange = useCallback(() => {
    resetScanOutput()
    setScanState(book ? 'ready' : 'idle')
  }, [book, resetScanOutput])

  const updateOcrSelection = useCallback(
    (nextSelection: OcrSelection) => {
      if (scanState === 'scanning') {
        return
      }

      setOcrSelections((currentSelections) => {
        const nextSelections = currentSelections.length
          ? [...currentSelections]
          : [...initialOcrSelections]
        const nextIndex = Math.min(activeSelectionIndex, nextSelections.length - 1)

        nextSelections[nextIndex] = nextSelection

        return nextSelections
      })
      resetScanAfterOcrConfigChange()
    },
    [activeSelectionIndex, resetScanAfterOcrConfigChange, scanState],
  )

  const addOcrSelection = useCallback(() => {
    if (scanState === 'scanning') {
      return
    }

    const activeSelection =
      ocrSelections[activeSelectionIndex] ?? ocrSelections[0] ?? initialOcrSelection
    const nextSelection = mirrorSelection(activeSelection)

    setOcrSelections((currentSelections) => [...currentSelections, nextSelection])
    setActiveSelectionIndex(ocrSelections.length)
    resetScanAfterOcrConfigChange()
  }, [activeSelectionIndex, ocrSelections, resetScanAfterOcrConfigChange, scanState])

  const removeOcrSelection = useCallback(
    (selectionIndex: number) => {
      if (scanState === 'scanning' || ocrSelections.length <= 1) {
        return
      }

      const nextSelections = ocrSelections.filter((_, index) => index !== selectionIndex)

      setOcrSelections(nextSelections)
      setActiveSelectionIndex((currentIndex) => {
        if (selectionIndex < currentIndex) {
          return currentIndex - 1
        }

        if (selectionIndex === currentIndex) {
          return Math.max(0, currentIndex - 1)
        }

        return Math.min(currentIndex, nextSelections.length - 1)
      })
      resetScanOutput()
      setScanState(book ? 'ready' : 'idle')
    },
    [book, ocrSelections, resetScanOutput, scanState],
  )

  const renderConfigPreview = useCallback(async (
    loadedDocument: PDFDocumentProxy,
    pageNumber: number,
  ) => {
    const requestId = configPreviewRequestRef.current + 1
    configPreviewRequestRef.current = requestId
    setIsConfigPreviewLoading(true)

    try {
      const boundedPageNumber = Math.round(clamp(pageNumber, 1, loadedDocument.numPages))
      const page = await loadedDocument.getPage(boundedPageNumber)
      const canvas = await renderPageToCanvas(page, CONFIG_RENDER_SCALE)
      const previewUrl = canvas.toDataURL('image/png')

      releaseCanvas(canvas)

      if (requestId === configPreviewRequestRef.current) {
        setConfigPageNumber(boundedPageNumber)
        setConfigPreviewUrl(previewUrl)
      }
    } catch (previewError) {
      if (requestId === configPreviewRequestRef.current) {
        setConfigPreviewUrl('')
        setError(`Nao consegui gerar a visualizacao do PDF. ${formatError(previewError)}`)
      }
    } finally {
      if (requestId === configPreviewRequestRef.current) {
        setIsConfigPreviewLoading(false)
      }
    }
  }, [])

  const openConfigPreviewPage = useCallback(
    async (nextPageNumber: number) => {
      if (!book) {
        return
      }

      const boundedPageNumber = Math.round(clamp(nextPageNumber, 1, book.pageCount))

      await renderConfigPreview(book.document, boundedPageNumber)
    },
    [book, renderConfigPreview],
  )

  const handleConfigPageChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextPageNumber = Number.parseInt(event.target.value, 10)

      if (Number.isNaN(nextPageNumber)) {
        return
      }

      void openConfigPreviewPage(nextPageNumber)
    },
    [openConfigPreviewPage],
  )

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]

      if (!file) {
        return
      }

      resetScanOutput()
      setConfigPreviewUrl('')
      setConfigPageNumber(1)

      if (!isPdf(file)) {
        setBook(null)
        setScanState('idle')
        setError('Escolha um arquivo PDF para continuar.')
        event.target.value = ''
        return
      }

      try {
        setScanState('idle')
        setError('')

        if (documentRef.current) {
          await documentRef.current.destroy()
          documentRef.current = null
        }

        const arrayBuffer = await file.arrayBuffer()
        const loadedDocument = await pdfjsLib.getDocument({ data: arrayBuffer })
          .promise

        documentRef.current = loadedDocument
        setBook({
          fileName: file.name,
          document: loadedDocument,
          pageCount: loadedDocument.numPages,
        })
        setScanState('ready')
        setIsConfigOpen(true)
        await renderConfigPreview(loadedDocument, 1)
      } catch (loadError) {
        setBook(null)
        setScanState('error')
        setError(`Nao consegui abrir este PDF. ${formatError(loadError)}`)
      }
    },
    [renderConfigPreview, resetScanOutput],
  )

  const scanBook = useCallback(async () => {
    if (!book || scanState === 'scanning') {
      return
    }

    let worker: Tesseract.Worker | null = null

    try {
      setScanState('scanning')
      setError('')
      setSearchResult(null)
      setPageMap(new Map())
      setProgress({
        currentPage: 0,
        totalPages: book.pageCount,
        ocrStatus: 'Preparando OCR',
        ocrProgress: 0,
      })

      worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        workerPath: tesseractWorkerUrl,
        logger: (message) => {
          setProgress((current) => ({
            ...current,
            ocrStatus: message.status,
            ocrProgress: message.progress,
          }))
        },
      })

      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      })

      const nextPageMap = new Map<string, PageMapping>()
      let previousPrintedPage: number | null = null

      for (let pageNumber = 1; pageNumber <= book.pageCount; pageNumber += 1) {
        setProgress((current) => ({
          ...current,
          currentPage: pageNumber,
          ocrStatus: 'Renderizando area do OCR',
          ocrProgress: 0,
        }))

        const page = await book.document.getPage(pageNumber)
        const pageCanvas = await renderPageToCanvas(page, OCR_RENDER_SCALE)
        const pageCandidates: OcrCandidate[] = []

        for (const selection of ocrSelections) {
          const ocrCanvas = cropOcrSelection(pageCanvas, selection)
          const result = await worker.recognize(ocrCanvas)
          const printedPage = extractPrintedPage(result.data.text)

          if (printedPage) {
            pageCandidates.push({
              printedPage,
              confidence: result.data.confidence,
            })
          }

          releaseCanvas(ocrCanvas)
        }

        const pageCandidate = choosePrintedPageCandidate(
          pageCandidates,
          previousPrintedPage,
        )

        if (pageCandidate) {
          previousPrintedPage = printedPageValue(pageCandidate)

          if (!nextPageMap.has(pageCandidate.printedPage)) {
            nextPageMap.set(pageCandidate.printedPage, {
              printedPage: pageCandidate.printedPage,
              pdfPageNumber: pageNumber,
              confidence: pageCandidate.confidence,
            })
          }
        }

        releaseCanvas(pageCanvas)
      }

      setPageMap(nextPageMap)
      setScanState('scanned')
      setProgress((current) => ({
        ...current,
        currentPage: book.pageCount,
        ocrStatus: 'Leitura finalizada',
        ocrProgress: 1,
      }))
    } catch (scanError) {
      setScanState('error')
      setError(`A leitura por OCR falhou. ${formatError(scanError)}`)
    } finally {
      if (worker) {
        await worker.terminate()
      }
    }
  }, [book, ocrSelections, scanState])

  const scanBookAutomatically = useCallback(async () => {
    if (!book || scanState === 'scanning') {
      return
    }

    let worker: Tesseract.Worker | null = null

    try {
      setScanState('scanning')
      setError('')
      setSearchResult(null)
      setPageMap(new Map())
      setProgress({
        currentPage: 0,
        totalPages: book.pageCount,
        ocrStatus: 'Preparando mapeamento automatico',
        ocrProgress: 0,
      })

      worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        workerPath: tesseractWorkerUrl,
        logger: (message) => {
          setProgress((current) => ({
            ...current,
            ocrStatus: message.status,
            ocrProgress: message.progress,
          }))
        },
      })

      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      })

      const nextPageMap = new Map<string, PageMapping>()
      let previousPrintedPage: number | null = null

      for (let pageNumber = 1; pageNumber <= book.pageCount; pageNumber += 1) {
        setProgress((current) => ({
          ...current,
          currentPage: pageNumber,
          ocrStatus: 'Procurando paginacao automaticamente',
          ocrProgress: 0,
        }))

        const page = await book.document.getPage(pageNumber)
        const pageCanvas = await renderPageToCanvas(page, OCR_RENDER_SCALE)
        const pageCandidates: AutoOcrCandidate[] = []

        for (const region of autoOcrRegions) {
          const ocrCanvas = cropOcrSelection(pageCanvas, region.selection)
          const result = await worker.recognize(ocrCanvas)

          pageCandidates.push(
            ...autoCandidatesFromText(
              result.data.text,
              result.data.confidence,
              region,
              pageNumber,
            ),
          )

          releaseCanvas(ocrCanvas)
        }

        const pageCandidate = chooseAutomaticPrintedPageCandidate(
          pageCandidates,
          previousPrintedPage,
          pageNumber,
        )

        if (pageCandidate) {
          previousPrintedPage = pageCandidate.value

          if (!nextPageMap.has(pageCandidate.printedPage)) {
            nextPageMap.set(pageCandidate.printedPage, {
              printedPage: pageCandidate.printedPage,
              pdfPageNumber: pageNumber,
              confidence: pageCandidate.confidence,
            })
          }
        }

        releaseCanvas(pageCanvas)
      }

      setPageMap(nextPageMap)
      setScanState('scanned')
      setProgress((current) => ({
        ...current,
        currentPage: book.pageCount,
        ocrStatus: 'Mapeamento automatico finalizado',
        ocrProgress: 1,
      }))
    } catch (scanError) {
      setScanState('error')
      setError(`O mapeamento automatico falhou. ${formatError(scanError)}`)
    } finally {
      if (worker) {
        await worker.terminate()
      }
    }
  }, [book, scanState])

  const searchPrintedPage = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      if (!book || scanState !== 'scanned' || isSearching) {
        return
      }

      const normalizedQuery = normalizePageNumber(query)

      if (!normalizedQuery) {
        setSearchResult(null)
        setError('Digite um numero de pagina com algarismos normais.')
        return
      }

      const match = pageMap.get(normalizedQuery)

      if (!match) {
        setSearchResult(null)
        setError(`Nao encontrei a pagina impressa ${normalizedQuery} neste PDF.`)
        return
      }

      try {
        setIsSearching(true)
        setError('')
        const page = await book.document.getPage(match.pdfPageNumber)
        const canvas = await renderPageToCanvas(page, PREVIEW_RENDER_SCALE)
        const previewUrl = canvas.toDataURL('image/png')

        releaseCanvas(canvas)
        setSearchResult({
          printedPage: match.printedPage,
          pdfPageNumber: match.pdfPageNumber,
          previewUrl,
        })
      } catch (previewError) {
        setSearchResult(null)
        setError(`Achei a pagina, mas nao consegui gerar o preview. ${formatError(previewError)}`)
      } finally {
        setIsSearching(false)
      }
    },
    [book, isSearching, pageMap, query, scanState],
  )

  const pointFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = selectorRef.current

    if (!element) {
      return null
    }

    const bounds = element.getBoundingClientRect()

    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    }
  }, [])

  const startSelection = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (scanState === 'scanning') {
        return
      }

      const point = pointFromPointer(event)

      if (!point) {
        return
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { startX: point.x, startY: point.y }
      updateOcrSelection({
        x: point.x,
        y: point.y,
        width: MIN_SELECTION_SIZE,
        height: MIN_SELECTION_SIZE,
      })
    },
    [pointFromPointer, scanState, updateOcrSelection],
  )

  const moveSelection = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) {
        return
      }

      const point = pointFromPointer(event)

      if (!point) {
        return
      }

      updateOcrSelection(
        selectionFromDrag(
          dragRef.current.startX,
          dragRef.current.startY,
          point.x,
          point.y,
        ),
      )
    },
    [pointFromPointer, updateOcrSelection],
  )

  const finishSelection = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
  }, [])

  const canScan = book && scanState !== 'scanning'
  const canSearch = scanState === 'scanned' && pageMap.size > 0 && !isSearching
  const progressLabel = useMemo(() => {
    if (scanState !== 'scanning' || !book) {
      return ''
    }

    const ocrPercent = Math.round(progress.ocrProgress * 100)
    return `Pagina ${progress.currentPage || 1} de ${book.pageCount}. ${progress.ocrStatus} ${ocrPercent}%`
  }, [book, progress, scanState])

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <a className="workspace-brand" href="#inicio" aria-label="Voltar para landing page">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 3h8l4 4v14H6z" />
              <path d="M14 3v5h4" />
              <path d="M8 13h8M8 17h5" />
            </svg>
          </span>
          <span>PDF OCR</span>
        </a>

        <button
          aria-label="Abrir configuracoes da area de OCR"
          className="icon-button"
          disabled={!book || scanState === 'scanning'}
          onClick={() => setIsConfigOpen(true)}
          type="button"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z" />
            <path d="M19 13.2a7.8 7.8 0 0 0 .1-1.2 7.8 7.8 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.1L14.3 3h-4.6l-.4 2.7a7 7 0 0 0-2 1.1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0-.1 1.2 7.8 7.8 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.1l.4 2.7h4.6l.4-2.7a7 7 0 0 0 2-1.1l2.4 1 2-3.5z" />
          </svg>
        </button>
      </header>

      <section className="workspace-grid" aria-label="Webapp de OCR">
        <div className="pdf-viewer">
          {searchResult ? (
            <figure className="page-preview">
              <figcaption>
                Pagina impressa {searchResult.printedPage} encontrada na pagina real{' '}
                {searchResult.pdfPageNumber}.
              </figcaption>
              <img
                alt={`Preview da pagina real ${searchResult.pdfPageNumber}`}
                src={searchResult.previewUrl}
              />
            </figure>
          ) : (
            <div className="viewer-empty">
              <p>Visualizador</p>
              <span>
                Envie um PDF, configure a area da paginacao e busque pelo numero
                impresso.
              </span>
            </div>
          )}
        </div>

        <aside className="control-panel" aria-label="Controles do PDF">
          <div>
            <p className="panel-kicker">Enviar PDF</p>
            <h1>Escolha o livro para mapear as paginas.</h1>
          </div>

          <label className="send-pdf-button">
            <span>Enviar PDF</span>
            <input
              accept="application/pdf,.pdf"
              disabled={scanState === 'scanning'}
              onChange={handleFileChange}
              type="file"
            />
          </label>

          {book ? (
            <p className="book-meta">
              <strong>{book.fileName}</strong>
              <span>{book.pageCount} pagina{book.pageCount === 1 ? '' : 's'}</span>
            </p>
          ) : (
            <p className="book-meta">Nenhum PDF carregado.</p>
          )}

          <div className="scan-actions">
            <button
              className="primary-button"
              disabled={!canScan}
              onClick={scanBookAutomatically}
              type="button"
            >
              {scanState === 'scanning' ? 'Mapeando...' : 'Mapear automaticamente'}
            </button>
            <button
              className="secondary-button"
              disabled={!canScan}
              onClick={scanBook}
              type="button"
            >
              Escanear areas
            </button>
          </div>

          {scanState === 'scanning' ? (
            <div className="progress-panel" aria-live="polite">
              <p>{progressLabel}</p>
              <progress
                max={book?.pageCount ?? 1}
                value={Math.max(progress.currentPage - 1, 0)}
              >
                {progress.currentPage}
              </progress>
            </div>
          ) : null}

          {scanState === 'scanned' ? (
            <p className="success-message" aria-live="polite">
              Mapa pronto com {pageMap.size} numero{pageMap.size === 1 ? '' : 's'}.
            </p>
          ) : null}

          <form className="search-form" onSubmit={searchPrintedPage}>
            <label htmlFor="printed-page">Numero impresso</label>
            <div className="search-row">
              <input
                id="printed-page"
                inputMode="numeric"
                onChange={(event) => setQuery(event.target.value)}
                pattern="[0-9]*"
                placeholder="Ex: 27"
                value={query}
              />
              <button className="secondary-button" disabled={!canSearch} type="submit">
                {isSearching ? 'Abrindo...' : 'Buscar'}
              </button>
            </div>
          </form>

          <div className="status-area" aria-live="polite">
            {error ? <p className="error-message">{error}</p> : null}
          </div>
        </aside>
      </section>

      {isConfigOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="config-title"
        >
          <section className="config-modal">
            <header className="modal-header">
              <div>
                <p className="panel-kicker">Configuracao</p>
                <h2 id="config-title">Selecione onde ficam as paginacoes.</h2>
              </div>
              <button
                aria-label="Fechar configuracoes"
                className="icon-button"
                onClick={() => setIsConfigOpen(false)}
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </header>

            <div className="config-layout">
              <div className="modal-viewer">
                {configPreviewUrl ? (
                  <div
                    className="pdf-selector"
                    onPointerCancel={finishSelection}
                    onPointerDown={startSelection}
                    onPointerMove={moveSelection}
                    onPointerUp={finishSelection}
                    ref={selectorRef}
                  >
                    <img
                      alt="Primeira pagina do PDF para selecionar as areas da paginacao"
                      draggable="false"
                      src={configPreviewUrl}
                    />
                    {ocrSelections.map((selection, index) => (
                      <div
                        aria-hidden="true"
                        className={`selection-box ${
                          index === activeSelectionIndex ? 'is-active' : ''
                        }`}
                        key={`${selection.x}-${selection.y}-${selection.width}-${selection.height}-${index}`}
                        style={selectionStyle(selection)}
                      >
                        <span>{index + 1}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="config-placeholder">
                    {isConfigPreviewLoading ? 'Carregando preview...' : 'Envie um PDF primeiro.'}
                  </div>
                )}
              </div>

              <div className="modal-instructions">
                <div className="config-page-controls">
                  <label htmlFor="config-page">Pagina de referencia</label>
                  <div className="config-page-row">
                    <button
                      className="page-step-button"
                      disabled={!book || configPageNumber <= 1 || isConfigPreviewLoading}
                      onClick={() => void openConfigPreviewPage(configPageNumber - 1)}
                      type="button"
                    >
                      Anterior
                    </button>
                    <input
                      disabled={!book || isConfigPreviewLoading}
                      id="config-page"
                      inputMode="numeric"
                      max={book?.pageCount ?? 1}
                      min="1"
                      onChange={handleConfigPageChange}
                      type="number"
                      value={configPageNumber}
                    />
                    <span>de {book?.pageCount ?? 0}</span>
                    <button
                      className="page-step-button"
                      disabled={
                        !book || configPageNumber >= book.pageCount || isConfigPreviewLoading
                      }
                      onClick={() => void openConfigPreviewPage(configPageNumber + 1)}
                      type="button"
                    >
                      Proxima
                    </button>
                  </div>
                </div>

                <p>
                  Arraste sobre o PDF para ajustar a area ativa. O OCR vai tentar
                  todas as areas configuradas em cada pagina.
                </p>

                <div className="selection-controls" aria-label="Areas verificadas pelo OCR">
                  {ocrSelections.map((_, index) => (
                    <div className="selection-control-row" key={index}>
                      <button
                        className={`selection-control ${
                          index === activeSelectionIndex ? 'is-active' : ''
                        }`}
                        disabled={scanState === 'scanning'}
                        onClick={() => setActiveSelectionIndex(index)}
                        type="button"
                      >
                        Area {index + 1}
                      </button>
                      <button
                        aria-label={`Remover area ${index + 1}`}
                        className="remove-selection-button"
                        disabled={scanState === 'scanning' || ocrSelections.length <= 1}
                        onClick={() => removeOcrSelection(index)}
                        type="button"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  className="secondary-button"
                  disabled={!book || scanState === 'scanning'}
                  onClick={addOcrSelection}
                  type="button"
                >
                  Adicionar area
                </button>

                <button
                  className="primary-button"
                  disabled={!book}
                  onClick={() => setIsConfigOpen(false)}
                  type="button"
                >
                  Salvar areas
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

export default OcrWorkspace
