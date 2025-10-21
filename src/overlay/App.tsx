import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'

import './App.css'
import { useHardwareBridge } from './hooks/useHardwareBridge'

const API_ENDPOINT = 'http://tars.media.mit.edu:50053/proforma'
const HARDWARE_SOCKET_URL = 'ws://10.134.5.198:8080/'
const HARDWARE_SLIDER_MAX = 1
const REPLACEMENT_MODEL_ENDPOINT = 'http://localhost:43110/replacement-model'
const RESULTS_MODEL_OPTIONS = [
  '/sample.glb',
  '/sample-2.glb',
  '/sample-3.glb',
  '/sample-5.glb'
] as const

const QUESTION_MIN = 0
const QUESTION_MAX = 10
const QUESTION_STEP = 0.25
const QUESTION_DEFAULT = 5

type Question = {
  id: string
  apiKey: string
  prompt: string
}

type Answer = {
  questionId: string
  prompt: string
  apiKey: string
  value: number
}

interface ResultSummary {
  [label: string]: unknown
}

interface ProgramEntry {
  name: string
  Number?: number | string | null
  Size?: number | string | null
  [key: string]: unknown
}

interface ResultData {
  summary_table?: { friendly?: ResultSummary | null }
  program_table?: { friendly?: ProgramEntry[] | null }
}

type ViewState = 'intro' | 'questions' | 'resultsModel' | 'resultsData'

const QUESTIONS: readonly Question[] = [
  {
    id: 'housingMicro',
    apiKey: 'ranking_Housing_Micro',
    prompt: 'How much do you prioritize affordable housing for students?'
  },
  {
    id: 'inBuildingGrocery',
    apiKey: 'ranking_InBuilding_Grocery',
    prompt: 'How much do you prioritize having groceries nearby?'
  },
  {
    id: 'communityCenter',
    apiKey: 'ranking_InBuilding_CommunityCenter',
    prompt: 'How much do you prioritize having a community center?'
  },
  {
    id: 'parkPlaza',
    apiKey: 'ranking_OffSite_ParkPlaza',
    prompt: 'How much do you prioritize having a public plaza?'
  }
] as const satisfies readonly Question[]

const INITIAL_VIEW: ViewState = 'intro'

const OverlayApp = (): ReactElement => {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [view, setView] = useState<ViewState>(INITIAL_VIEW)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [resultData, setResultData] = useState<ResultData | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const initialValue = useMemo(() => QUESTION_DEFAULT, [])
  const [currentValue, setCurrentValue] = useState(initialValue)

  const postReplacementModel = useCallback((modelPath: string) => {
    const rotation = modelPath.includes('clear') ? 30 : 120
    fetch(REPLACEMENT_MODEL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ modelPath, rotation }),
    }).catch((error) => {
      console.error('Model replacement request failed', error)
    })
  }, [])

  useEffect(() => {
    postReplacementModel('clear')
  }, [postReplacementModel])

  useEffect(() => {
    if (view !== 'questions') {
      return
    }
    setCurrentValue(QUESTION_DEFAULT)
  }, [currentIndex, view])

  const question = QUESTIONS[currentIndex] ?? QUESTIONS[0]

  const buildPayload = useCallback((finalAnswers: Answer[]) => {
    const payload: Record<string, unknown> = {
      model: 'gpt-4o',
      temperature: 0.6,
      max_tokens: 600,
    }

    QUESTIONS.forEach((item, index) => {
      const entry = finalAnswers[index]
      const fallback = QUESTION_DEFAULT
      const value = entry?.value ?? fallback
      payload[item.apiKey] = Number.isFinite(value) ? Number(value) : fallback
    })

    return payload
  }, [])

  const submitAnswers = useCallback(
    async (finalAnswers: Answer[]) => {
      setIsSubmitting(true)
      setSubmitError(null)
      setResultData(null)

      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify(buildPayload(finalAnswers)),
        })

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`)
        }

        const rawBody = await response.text()
        const sanitized = rawBody.trim().replace(/%$/, '')
        const parsed = JSON.parse(sanitized)
        setResultData(parsed)
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Unknown error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [buildPayload],
  )

  const handleRestart = useCallback(() => {
    postReplacementModel('clear')
    setAnswers([])
    setCurrentIndex(0)
    setResultData(null)
    setSubmitError(null)
    setIsSubmitting(false)
    setView('intro')
  }, [postReplacementModel])

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    console.log('Confirm clicked in view', view)
    if (view === 'intro') {
      setView('questions')
      return
    }
    if (view === 'resultsModel') {
      setView('resultsData')
      return
    }
    // handle restart
    if (view === 'resultsData') {
      handleRestart()
      return
    }

    const activeQuestion = QUESTIONS[currentIndex]
    const updatedAnswers = [...answers]
    updatedAnswers[currentIndex] = {
      questionId: activeQuestion.id,
      prompt: activeQuestion.prompt,
      apiKey: activeQuestion.apiKey,
      value: currentValue,
    }
    setAnswers(updatedAnswers)

    if (currentIndex === QUESTIONS.length - 1) {
      setView('resultsModel')
      void submitAnswers(updatedAnswers)
      return
    }

    setCurrentIndex((previous: number) => previous + 1)
  }, [answers, currentIndex, currentValue, handleRestart, isSubmitting, submitAnswers, view])

  const summaryFriendly = resultData?.summary_table?.friendly ?? null
  const programFriendly = resultData?.program_table?.friendly ?? []

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '—'
    }

    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? value.toString()
        : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    }

    return String(value)
  }

  const translateHardwareValue = useCallback((rawValue: unknown) => {
    const numericValue = Number(rawValue)
    if (!Number.isFinite(numericValue)) {
      return null
    }
    const span = QUESTION_MAX - QUESTION_MIN || 1
    const clampedSensorValue = Math.max(0, Math.min(numericValue, HARDWARE_SLIDER_MAX))
    const scaled = QUESTION_MIN + (clampedSensorValue / HARDWARE_SLIDER_MAX) * span
    const stepped = Math.round(scaled / QUESTION_STEP) * QUESTION_STEP
    return Number(Math.min(QUESTION_MAX, Math.max(QUESTION_MIN, stepped)).toFixed(4))
  }, [])

  const handleHardwareSlider = useCallback(
    (rawValue: unknown) => {
      if (view !== 'questions') {
        return
      }
      const translated = translateHardwareValue(rawValue)
      if (translated === null) {
        return
      }
      setCurrentValue(translated)
    },
    [translateHardwareValue, view],
  )

  const { connectionState: hardwareStatus } = useHardwareBridge({
    url: HARDWARE_SOCKET_URL,
    onSliderChange: handleHardwareSlider,
    onConfirm: handleConfirm,
    shouldListen: true,
  })

  useEffect(() => {
    if (view === 'resultsModel') {
      const randomIndex = Math.floor(Math.random() * RESULTS_MODEL_OPTIONS.length)
      const selectedModel = RESULTS_MODEL_OPTIONS[randomIndex]
      postReplacementModel(selectedModel)
    }
  }, [view, postReplacementModel])

  if (view === 'intro') {
    return (
      <div className="app-shell">
        <main className="intro-screen">
          <div className="intro-content">
            <h1 className="intro-title">Dynamic Zoning</h1>
            <h2 className="intro-subtitle">Answer Questions and Obtain a Development Proposal</h2>
            <p className="intro-message">Press Button to Continue</p>
          </div>
          <footer className="intro-footer">
            <button type="button" className="confirm-button" onClick={handleConfirm}>
              <span className="sr-only">Start questionnaire</span>
            </button>
          </footer>
        </main>
      </div>
    )
  }

  if (view === 'resultsModel') {
    return (
      <div className="app-shell">
        <main className="results-model-screen">
          <div className="results-model-content">
            <h1 className="results-model-title">This is your site</h1>
            {isSubmitting && (
              <p className="api-status">Generating proposal…</p>
            )}
            {submitError && !isSubmitting && (
              <p className="api-status error">{submitError}</p>
            )}
          </div>
          <footer className="results-footer">
            <button type="button" className="confirm-button" onClick={handleConfirm}>
              <span className="sr-only">View proposal details</span>
            </button>
          </footer>
        </main>
      </div>
    )
  }

  if (view === 'resultsData') {
    return (
      <div className="app-shell">
        <main className="results-screen">
          <h1 className="results-title">Results</h1>
          <div className="results-body">
            <section className="results-section">
              <h2 className="results-subtitle">Suggested development mix</h2>
              {isSubmitting && (
                <p className="api-status">Generating proposal…</p>
              )}
              {submitError && !isSubmitting && (
                <p className="api-status error">{submitError}</p>
              )}
              {summaryFriendly && !isSubmitting && !submitError && (
                <dl className="summary-grid">
                  {Object.entries(summaryFriendly).map(([label, value]) => (
                    <div className="summary-row" key={label}>
                      <dt>{label}</dt>
                      <dd>{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {programFriendly.length > 0 && !isSubmitting && !submitError && (
                <div className="program-table">
                  <div className="program-row program-header">
                    <span>Program</span>
                    <span>Number</span>
                    <span>Size (sq ft)</span>
                  </div>
                  {programFriendly.map((entry) => (
                    <div className="program-row" key={entry.name}>
                      <span>{entry.name}</span>
                      <span>{formatValue(entry.Number)}</span>
                      <span>{formatValue(entry.Size)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <footer className="results-footer">
                <button type="button" className="confirm-button" onClick={handleConfirm}>
              <span className="sr-only">Restart</span>
            </button>
          </footer>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="question-screen">
        <div className="question-content">
          <div className="question-meta">
            <span className="question-progress">
              Question {currentIndex + 1} of {QUESTIONS.length}
            </span>
            <span className="hardware-status">Hardware: {hardwareStatus}</span>
          </div>
          <h1 className="question-prompt">{question.prompt}</h1>
          <div className="question-controls">
            <div className="slider-area">
              <label className="slider-label" htmlFor="question-slider">
                {currentValue}
              </label>
              <input
                id="question-slider"
                type="range"
                min={QUESTION_MIN}
                max={QUESTION_MAX}
                step={QUESTION_STEP}
                value={currentValue}
                onChange={(event) => setCurrentValue(Number(event.target.value))}
                className="slider"
              />
              <div className="slider-scale">
                <span>{QUESTION_MIN}</span>
                <span>{QUESTION_MAX}</span>
              </div>
            </div>
            <button type="button" className="confirm-button" onClick={handleConfirm}>
              <span className="sr-only">Confirm selection</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

const App = (): ReactElement => {
  return (
    <div className='overlay-app'>
      <OverlayApp />
    </div>
  )
}

export default App
