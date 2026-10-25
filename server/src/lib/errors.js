import multer from 'multer';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, message, details);
export const unauthorized = (message = 'Please log in to continue') => new HttpError(401, message);
export const forbidden = (message = 'You are not allowed to do this') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message, details) => new HttpError(409, message, details);

// Friendly messages for unique-index violations, keyed by index name.
const UNIQUE_MESSAGES = {
  students_email_key: 'An account with this email already exists',
  students_register_no_key: 'This register number is already registered',
  admins_email_key: 'An admin with this email already exists',
  departments_name_key: 'A department with this name already exists',
  departments_code_key: 'A department with this code already exists',
};

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large' });
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err?.code === '23505') {
    return res.status(409).json({ error: UNIQUE_MESSAGES[err.constraint] || 'This record already exists' });
  }
  if (err?.code === '23503') {
    return res.status(409).json({ error: 'This record is still in use and cannot be changed' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
