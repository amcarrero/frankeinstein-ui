import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import "./App.css";
import { useHardwareBridge } from "./hooks/useHardwareBridge";

const API_ENDPOINT = "http://tars.media.mit.edu:50053/proforma";
const HARDWARE_SOCKET_URL = "ws://10.134.5.198:8080/";
const HARDWARE_SLIDER_MAX = 1;
const REPLACEMENT_MODEL_ENDPOINT = "http://localhost:43110/replacement-model";
const RESULTS_MODEL_OPTIONS = [
  "/sample.glb",
  "/sample-2.glb",
  "/sample-3.glb",
  "/sample-5.glb",
] as const;

const QUESTION_MIN = 0;
const QUESTION_MAX = 10;
const QUESTION_STEP = 0.25;
const QUESTION_DEFAULT = 5;

const PREFERENCE_MIN = 0;
const PREFERENCE_MAX = 10;
const PREFERENCE_STEP = 0.5;
const PREFERENCE_DEFAULT = (PREFERENCE_MIN + PREFERENCE_MAX) / 2;
const SLIDER_SUBMISSION_ENDPOINT = `${REPLACEMENT_MODEL_ENDPOINT}/slider-values`;

type Question = {
  id: string;
  apiKey: string;
  prompt: string;
};

type Answer = {
  questionId: string;
  prompt: string;
  apiKey: string;
  value: number;
};

interface ResultSummary {
  [label: string]: unknown;
}

interface ProgramEntry {
  name: string;
  Number?: number | string | null;
  Size?: number | string | null;
  [key: string]: unknown;
}

interface ResultData {
  summary_table?: { friendly?: ResultSummary | null };
  program_table?: { friendly?: ProgramEntry[] | null };
}

type ViewState =
  | "intro"
  | "questions"
  | "resultsModel"
  | "resultsData"
  | "preference";

const SUMMARY_TRADITIONAL = {
  Stories: 4,
  "MRU Stories": 4,
  NPV: 22820057.0936,
  IRR: 0.1537,
  "Likelihood of Construction": 0.1881,
};

const PROGRAM_TRADITIONAL = [
  { name: "MRU", Number: 48, Size: 36000 },
  { name: "Micro Units", Number: 0, Size: 0 },
  { name: "Grocery Store", Number: 0, Size: 0 },
  { name: "Community Center", Number: 0, Size: 0 },
  { name: "Park/Plaza", Number: 0, Size: 0 },
];

const QUESTIONS: readonly Question[] = [
  {
    id: "housingMicro",
    apiKey: "ranking_Housing_Micro",
    prompt: "Affordable Housing",
  },
  {
    id: "inBuildingGrocery",
    apiKey: "ranking_InBuilding_Grocery",
    prompt: "Grocery Store",
  },
  {
    id: "communityCenter",
    apiKey: "ranking_InBuilding_CommunityCenter",
    prompt: "Community Center",
  },
  {
    id: "parkPlaza",
    apiKey: "ranking_OffSite_ParkPlaza",
    prompt: "Parks and Plaza",
  },
] as const satisfies readonly Question[];

const INITIAL_VIEW: ViewState = "intro";

const generateSessionId = (): string => {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return randomUuid;
  }
  return `session-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const OverlayApp = (): ReactElement => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultData, setResultData] = useState<ResultData | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preferenceValue, setPreferenceValue] = useState(PREFERENCE_DEFAULT);
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());

  const initialValue = useMemo(() => QUESTION_DEFAULT, []);
  const [currentValue, setCurrentValue] = useState(initialValue);

  const postReplacementModel = useCallback((modelPath: string) => {
    const rotation = modelPath.includes("clear") ? 30 : 120;
    fetch(REPLACEMENT_MODEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ modelPath, rotation }),
    }).catch((error) => {
      console.error("Model replacement request failed", error);
    });
  }, []);

  useEffect(() => {
    postReplacementModel("clear");
  }, [postReplacementModel]);

  useEffect(() => {
    if (view !== "questions") {
      return;
    }

    const existingAnswer = answers[currentIndex];
    if (existingAnswer) {
      setCurrentValue(existingAnswer.value);
      return;
    }

    if (currentIndex > 0) {
      const previousAnswer = answers[currentIndex - 1];
      if (previousAnswer) {
        setCurrentValue(previousAnswer.value);
        return;
      }
    }

    setCurrentValue(QUESTION_DEFAULT);
  }, [answers, currentIndex, view]);

  const question = QUESTIONS[currentIndex] ?? QUESTIONS[0];

  const buildPayload = useCallback((finalAnswers: Answer[]) => {
    const payload: Record<string, unknown> = {
      model: "gpt-4o",
      temperature: 0.6,
      max_tokens: 600,
    };

    QUESTIONS.forEach((item, index) => {
      const entry = finalAnswers[index];
      const fallback = QUESTION_DEFAULT;
      const value = entry?.value ?? fallback;
      payload[item.apiKey] = Number.isFinite(value) ? Number(value) : fallback;
    });

    return payload;
  }, []);

  const submitAnswers = useCallback(
    async (finalAnswers: Answer[]) => {
      setIsSubmitting(true);
      setSubmitError(null);
      setResultData(null);

      try {
        const response = await fetch(API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(buildPayload(finalAnswers)),
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }

        const rawBody = await response.text();
        const sanitized = rawBody.trim().replace(/%$/, "");
        const parsed = JSON.parse(sanitized);
        setResultData(parsed);
      } catch (error) {
        setSubmitError(
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        setIsSubmitting(false);
      }
    },
    [buildPayload],
  );

  const persistSliderSubmission = useCallback(
    async ({
      questionId,
      questionText,
      value,
    }: {
      questionId: string;
      questionText?: string;
      value: number;
    }) => {
      if (!Number.isFinite(value)) {
        return;
      }
      const payload: Record<string, unknown> = {
        sessionId,
        questionId,
        value,
        recordedAt: new Date().toISOString(),
      };
      if (questionText != null) {
        payload.questionText = questionText;
      }
      try {
        const response = await fetch(SLIDER_SUBMISSION_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error(
            `Failed to persist slider submission for ${questionId} (status ${response.status})`,
          );
        }
      } catch (error) {
        console.error(
          `Unable to record slider submission for ${questionId}`,
          error instanceof Error ? error.message : error,
        );
      }
    },
    [sessionId],
  );

  const submitSliderPreference = useCallback(
    async (value: number) => {
      await persistSliderSubmission({
        questionId: "zoningPreference",
        questionText: "Zoning Preference (Classic vs Dynamic)",
        value,
      });
    },
    [persistSliderSubmission],
  );

  const handleRestart = useCallback(() => {
    postReplacementModel("clear");
    setAnswers([]);
    setCurrentIndex(0);
    setResultData(null);
    setSubmitError(null);
    setIsSubmitting(false);
    setPreferenceValue(PREFERENCE_DEFAULT);
    setSessionId(generateSessionId());
    setView("intro");
  }, [postReplacementModel]);

  const handleConfirm = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    if (view === "intro") {
      setView("questions");
      return;
    }
    if (view === "resultsModel") {
      setView("resultsData");
      return;
    }

    if (view === "resultsData") {
      setView("preference");
      return;
    }

    if (view === "preference") {
      await submitSliderPreference(preferenceValue);
      handleRestart();
      return;
    }

    const activeQuestion = QUESTIONS[currentIndex];
    const updatedAnswers = [...answers];
    updatedAnswers[currentIndex] = {
      questionId: activeQuestion.id,
      prompt: activeQuestion.prompt,
      apiKey: activeQuestion.apiKey,
      value: currentValue,
    };
    setAnswers(updatedAnswers);
    await persistSliderSubmission({
      questionId: activeQuestion.id,
      questionText: activeQuestion.prompt,
      value: currentValue,
    });

    if (currentIndex === QUESTIONS.length - 1) {
      setView("resultsModel");
      void submitAnswers(updatedAnswers);
      return;
    }

    setCurrentIndex((previous: number) => previous + 1);
  }, [
    answers,
    currentIndex,
    currentValue,
    handleRestart,
    isSubmitting,
    preferenceValue,
    persistSliderSubmission,
    submitAnswers,
    submitSliderPreference,
    view,
  ]);

  const summaryFriendly = (resultData?.summary_table?.friendly ??
    null) as ResultSummary | null;
  const programFriendlyRaw = resultData?.program_table?.friendly ?? null;
  const programFriendly = Array.isArray(programFriendlyRaw)
    ? (programFriendlyRaw as ProgramEntry[])
    : [];

  const translateHardwareValue = useCallback(
    (
      rawValue: unknown,
      config?: { min: number; max: number; step: number },
    ) => {
      const numericValue = Number(rawValue);
      if (!Number.isFinite(numericValue)) {
        return null;
      }
      const min = config?.min ?? QUESTION_MIN;
      const max = config?.max ?? QUESTION_MAX;
      const step = config?.step ?? QUESTION_STEP;
      const span = max - min || 1;
      const clampedSensorValue = Math.max(
        0,
        Math.min(numericValue, HARDWARE_SLIDER_MAX),
      );
      const scaled = min + (clampedSensorValue / HARDWARE_SLIDER_MAX) * span;
      const stepped = Math.round(scaled / step) * step;
      return Number(
        Math.min(max, Math.max(min, stepped)).toFixed(4),
      );
    },
    [],
  );

  const handleHardwareSlider = useCallback(
    (rawValue: unknown) => {
      if (view === "questions") {
        const translated = translateHardwareValue(rawValue);
        if (translated !== null) {
          setCurrentValue(translated);
        }
        return;
      }
      if (view === "preference") {
        const translated = translateHardwareValue(rawValue, {
          min: PREFERENCE_MIN,
          max: PREFERENCE_MAX,
          step: PREFERENCE_STEP,
        });
        if (translated !== null) {
          setPreferenceValue(translated);
        }
      }
    },
    [setCurrentValue, setPreferenceValue, translateHardwareValue, view],
  );

  const { connectionState: hardwareStatus } = useHardwareBridge({
    url: HARDWARE_SOCKET_URL,
    onSliderChange: handleHardwareSlider,
    onConfirm: handleConfirm,
    shouldListen: true,
  });

  useEffect(() => {
    if (view === "resultsModel") {
      const randomIndex = Math.floor(
        Math.random() * RESULTS_MODEL_OPTIONS.length,
      );
      const selectedModel = RESULTS_MODEL_OPTIONS[randomIndex];
      postReplacementModel(selectedModel);
    }
  }, [view, postReplacementModel]);

  if (view === "intro") {
    return (
      <div className="app-shell">
        <main className="intro-screen">
          <div className="intro-content">
            <h1 className="intro-title">Dynamic Zoning</h1>
            <h2 className="intro-subtitle">
              Using the slider, rate the different amenities/benefits to have
              them built in exchange of development.
            </h2>
            <p className="intro-message">
              Push Button to Start Rating Amenities
            </p>
          </div>
          <footer className="intro-footer">
            <button
              type="button"
              className="confirm-button"
              onClick={handleConfirm}
            >
              <span className="sr-only">Start questionnaire</span>
            </button>
          </footer>
        </main>
      </div>
    );
  }

  if (view === "resultsModel") {
    return (
      <div className="app-shell">
        <main className="results-model-screen">
          <div className="results-model-content">
            <div className="results-model-title">Developer Response</div>
            {isSubmitting && <p className="api-status">Generating proposal…</p>}
            {submitError && !isSubmitting && (
              <p className="api-status error">{submitError}</p>
            )}
            {!isSubmitting && (
              <p className="api-status">Generating proposal done!</p>
            )}
            <p className="continue-hint">PRESS BUTTON TO CONTINUE</p>
          </div>
          <footer className="results-footer">
            <button
              type="button"
              className="confirm-button"
              onClick={handleConfirm}
            >
              <span className="sr-only">View proposal details</span>
            </button>
          </footer>
        </main>
      </div>
    );
  }

  if (view === "resultsData") {
    return (
      <div className="app-shell">
        <main className="results-screen">
          <div className="results-title">Project Breakdown</div>
          <div className="results-body">
            {renderResult(
              "Traditional Zoning",
              SUMMARY_TRADITIONAL,
              PROGRAM_TRADITIONAL,
              "#EF1300",
            )}
            {renderResult(
              "Dynamic Zoning",
              summaryFriendly,
              programFriendly,
              "#00FF55",
              submitError,
              isSubmitting,
            )}
          </div>
          <p className="continue-hint">PRESS BUTTON TO CONTINUE</p>
          <footer className="results-footer">
            <button
              type="button"
              className="confirm-button"
              onClick={handleConfirm}
            >
              <span className="sr-only">Open preference slider</span>
            </button>
          </footer>
        </main>
      </div>
    );
  }

  if (view === "preference") {
    return (
      <div className="app-shell">
        <main className="question-screen preference-screen">
          <div className="question-content">
            <div className="question-meta">
              <span className="question-progress">Preference</span>
              <span className="hardware-status">Hardware: {hardwareStatus}</span>
            </div>
            <div>
              <h1 className="question-prompt">Which approach do you prefer?</h1>
              <h2>Drag the slider toward Classic or Dynamic zoning.</h2>
            </div>
            <div className="preference-summary">
              {renderPreferenceSummary(
                "Traditional Zoning",
                SUMMARY_TRADITIONAL,
                PROGRAM_TRADITIONAL,
                "#EF1300",
              )}
              {renderPreferenceSummary(
                "Dynamic Zoning",
                summaryFriendly,
                programFriendly,
                "#00FF55",
              )}
            </div>
            <div className="question-controls">
              <div className="slider-area">
                <label className="slider-label" htmlFor="preference-slider">
                  {preferenceValue.toFixed(1)}
                </label>
                <input
                  id="preference-slider"
                  type="range"
                  min={PREFERENCE_MIN}
                  max={PREFERENCE_MAX}
                  step={PREFERENCE_STEP}
                  value={preferenceValue}
                  onChange={(event) =>
                    setPreferenceValue(Number(event.target.value))
                  }
                  className="slider"
                />
                <div className="slider-scale">
                  <span>Classic</span>
                  <span>Dynamic</span>
                </div>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="confirm-button"
            onClick={handleConfirm}
          >
            <span className="sr-only">Confirm preference</span>
          </button>
        </main>
      </div>
    );
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
          <div>
            <h1 className="question-prompt">{question.prompt}</h1>
            <h2>How important is this to you?</h2>
          </div>
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
                onChange={(event) =>
                  setCurrentValue(Number(event.target.value))
                }
                className="slider"
              />
              <div className="slider-scale">
                <span>LOW</span>
                <span>HIGH</span>
              </div>
            </div>
          </div>
        </div>
        {/* Fixed confirm button for question view */}
        <button
          type="button"
          className="confirm-button"
          onClick={handleConfirm}
        >
          <span className="sr-only">Confirm selection</span>
        </button>
      </main>
    </div>
  );
};

function renderPreferenceSummary(
  title: string,
  summary: ResultSummary | null,
  program: ProgramEntry[] | null,
  highlightColor = "#ffffff",
): ReactElement {
  const likelihoodKey = "Likelihood of Construction";
  const storiesValue = formatValueWithHint(summary?.["Stories"], "Stories");
  const likelihoodValue = formatValueWithHint(
    summary?.[likelihoodKey],
    likelihoodKey,
  );
  const normalizedProgram = Array.isArray(program) ? program : [];
  const amenityPrograms = normalizedProgram.filter(
    (entry) => entry?.name != null,
  );

  return (
    <section className="preference-summary-card">
      <h3 className="preference-summary-title">{title}</h3>
      <dl className="preference-summary-metrics">
        <div className="preference-summary-row">
          <dt>Stories</dt>
          <dd style={{ color: highlightColor }}>{storiesValue}</dd>
        </div>
        <div className="preference-summary-row">
          <dt>{likelihoodKey}</dt>
          <dd style={{ color: highlightColor }}>{likelihoodValue}</dd>
        </div>
      </dl>
      {amenityPrograms.length > 0 && (
        <ul className="preference-program-list">
          {amenityPrograms.map((entry, index) => (
            <li key={`${entry?.name ?? `program-${index}`}`}>
              <span>{entry?.name ?? "Program"}</span>
              <span>{formatValue(entry?.Number)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function renderResult(
  title: string,
  summary: ResultSummary | null,
  program: ProgramEntry[] | null,
  color = "#ffffff",
  submitError: string | null = null,
  isSubmitting = false,
): ReactElement {
  const likelihood = "Likelihood of Construction";
  const normalizedProgram = Array.isArray(program) ? program : [];
  const renamedProgram = normalizedProgram.map((entry) =>
    entry?.name === "MRU" ? { ...entry, name: "Market Rate Units" } : entry,
  );
  const marketIndex = renamedProgram.findIndex(
    (entry) => entry?.name === "Market Rate Units",
  );
  const market =
    marketIndex >= 0 ? renamedProgram[marketIndex] ?? null : null;
  const rest =
    marketIndex >= 0
      ? renamedProgram.filter((_, index) => index !== marketIndex)
      : renamedProgram;
  const showSummary = summary != null && !submitError && !isSubmitting;
  const showProgram =
    (market != null || rest.length > 0) && !submitError && !isSubmitting;

  return (
    <section className="results-section">
      <h2 className="results-subtitle">{title}</h2>
      {isSubmitting && <p className="api-status">Generating proposal…</p>}
      {submitError && !isSubmitting && (
        <p className="api-status error">{submitError}</p>
      )}

      {showSummary && (
        <dl className="summary-grid">
          <div className="summary-row">
            <dt>Stories</dt>
            <dd style={{ color }}>
              {formatValueWithHint(summary?.["Stories"], "Stories")}
            </dd>
            <dt>{likelihood}</dt>
            <dd style={{ color }}>
              {formatValueWithHint(summary?.[likelihood], likelihood)}
            </dd>
          </div>
        </dl>
      )}

      {showProgram && (
        <div className="program-table">
          <div className="program-row program-header">
            <span>Program</span>
            <span>Number</span>
          </div>

          {market != null && (
            <div
              className="program-row"
              key="market"
              style={{ color, marginBottom: "10px" }}
            >
              <span>{market.name ?? "Market Rate Units"}</span>
              <span>{formatValue(market.Number)}</span>
            </div>
          )}

          {rest.map((entry, index) => (
            <div
              className="program-row"
              key={`${entry.name ?? `program-${index}`}`}
            >
              <span>{entry.name ?? "Program"}</span>
              <span>{formatValue(entry.Number)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDollar(
  amount: unknown,
  locales: Intl.LocalesArgument = "en-US",
  currencySymbol = "$",
  spaceAfterSymbol = true,
): string {
  let numericValue: number | null = null;
  if (typeof amount === "number") {
    numericValue = amount;
  } else if (typeof amount === "string") {
    const parsed = Number(amount.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(parsed)) {
      numericValue = parsed;
    }
  }

  if (numericValue == null || !Number.isFinite(numericValue)) {
    return amount == null ? "—" : String(amount);
  }

  const formatted = new Intl.NumberFormat(locales, {
    maximumFractionDigits: 0,
  }).format(Math.round(numericValue));

  return `${currencySymbol}${spaceAfterSymbol ? " " : ""}${formatted}`;
}

const formatValueWithHint = (value: unknown, hint: string): string => {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  const fallback = value == null ? "—" : String(value);

  switch (hint) {
    case "NPV":
    case "dollars":
      return formatDollar(value);
    case "MRU Stories":
    case "stories":
    case "Stories":
    case "story": {
      if (Number.isFinite(numericValue)) {
        const storyNum = Math.ceil(numericValue);
        return storyNum < 2 ? "one story" : storyNum.toString();
      }
      return fallback;
    }
    case "IRR":
    case "Likelihood of Construction":
    case "percentage": {
      if (Number.isFinite(numericValue)) {
        const percentage = Math.floor(numericValue * 100.0);
        return `${percentage} %`;
      }
      return fallback;
    }
    default:
      return fallback;
  }
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? value.toString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
};

const App = (): ReactElement => {
  return (
    <div className="overlay-app">
      <OverlayApp />
    </div>
  );
};

export default App;
