import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parses data with a zod schema, throwing a 400 with per-field messages on failure. */
export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    const first = Object.entries(fields)[0];
    throw badRequest(first ? `${first[0]}: ${first[1]}` : 'Invalid input', fields);
  }
  return result.data;
}

const trimmed = (max) => z.string().trim().max(max);
// Missing, null and blank strings all become null.
const optionalText = (max) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null), z.string().max(max).nullable());

export const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const studentProfileSchema = z.object({
  name: trimmed(120).min(2, 'Name is required'),
  phone: optionalText(20).refine((v) => v === null || /^[0-9+\-\s()]{7,20}$/.test(v), 'Enter a valid phone number'),
  college: trimmed(200).min(2, 'College is required'),
  department: optionalText(120),
  year_of_study: z.coerce.number().int().min(1).max(8).nullable().optional(),
  roll_number: trimmed(60).min(1, 'Roll / registration number is required'),
});

export const registerSchema = studentProfileSchema.extend({ email, password });

export const loginSchema = z.object({ email, password: z.string().min(1, 'Password is required').max(128) });

export const questionSchema = z
  .object({
    text: trimmed(5000).min(1, 'Question text is required'),
    image_url: optionalText(1000).refine((v) => v === null || /^https?:\/\//i.test(v), 'Image URL must start with http(s)://'),
    options: z.array(trimmed(1000).min(1, 'Options cannot be empty')).min(2, 'At least 2 options').max(6, 'At most 6 options'),
    correct_option: z.coerce.number().int().min(0),
    explanation: optionalText(5000),
    category: trimmed(100).min(1).default('General'),
    difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
    marks: z.coerce.number().positive().max(1000).default(1),
  })
  .refine((q) => q.correct_option < q.options.length, {
    message: 'Correct option must be one of the options',
    path: ['correct_option'],
  });

const dateTime = z.coerce.date({ error: 'Enter a valid date and time' });

export const competitionSchema = z
  .object({
    title: trimmed(200).min(3, 'Title is required'),
    description: optionalText(5000),
    rules: optionalText(10000),
    start_time: dateTime,
    end_time: dateTime,
    duration_minutes: z.coerce.number().int().min(1).max(24 * 60),
    question_count: z.coerce.number().int().positive().nullable().optional().default(null),
    shuffle_questions: z.boolean().default(true),
    shuffle_options: z.boolean().default(true),
    negative_mark: z.coerce.number().min(0).max(100).default(0),
    max_tab_switches: z.coerce.number().int().min(0).nullable().optional().default(null),
    status: z.enum(['draft', 'published']).default('draft'),
    registration_open: z.boolean().default(true),
    show_result_immediately: z.boolean().default(false),
  })
  .refine((c) => c.end_time > c.start_time, { message: 'End time must be after start time', path: ['end_time'] });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional().default(''),
});

export { z };
