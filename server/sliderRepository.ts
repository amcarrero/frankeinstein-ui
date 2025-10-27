import { Pool } from 'pg'

export interface SliderSubmission {
  sessionId: string
  questionId: string
  questionText?: string | null
  value: number
  recordedAt?: Date
}

export interface SliderRepository {
  saveSliderSubmission: (submission: SliderSubmission) => Promise<void>
  close: () => Promise<void>
}

interface SliderRepositoryOptions {
  connectionString?: string
}

export const createSliderRepository = async (
  options: SliderRepositoryOptions = {}
): Promise<SliderRepository> => {
  const connectionString =
    options.connectionString ?? process.env.DATABASE_URL ?? null

  if (connectionString == null || connectionString.trim().length === 0) {
    throw new Error(
      'DATABASE_URL environment variable must be set to persist slider submissions.'
    )
  }

  const pool = new Pool({ connectionString })

  await ensureSchema(pool)

  return {
    saveSliderSubmission: submission => persistSubmission(pool, submission),
    close: async () => {
      await pool.end()
    }
  }
}

const ensureSchema = async (pool: Pool): Promise<void> => {
  await pool.query(`
    create table if not exists slider_responses (
      id serial primary key,
      session_id text not null,
      question_id text not null,
      question_text text,
      value double precision not null,
      recorded_at timestamptz not null default now()
    );
  `)

  await pool.query(`
    create index if not exists idx_slider_responses_session
      on slider_responses (session_id);
  `)
}

const persistSubmission = async (
  pool: Pool,
  submission: SliderSubmission
): Promise<void> => {
  if (!Number.isFinite(submission.value)) {
    throw new Error('Slider submission value must be a finite number.')
  }

  await pool.query(
    `
      insert into slider_responses (
        session_id,
        question_id,
        question_text,
        value,
        recorded_at
      )
      values ($1, $2, $3, $4, coalesce($5, now()))
    `,
    [
      submission.sessionId,
      submission.questionId,
      submission.questionText ?? null,
      submission.value,
      submission.recordedAt ?? null
    ]
  )
}
