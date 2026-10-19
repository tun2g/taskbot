import { Response } from 'express';
import type { ZodError } from 'zod';

const ERROR_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

/**
 * Send `{ error, message, statusCode }`. `message` is shown verbatim in the web app,
 * so it must be a plain, actionable sentence.
 */
export function sendError(res: Response, statusCode: number, message: string, error?: string) {
  res.status(statusCode).json({ error: error ?? ERROR_NAMES[statusCode] ?? 'Error', message, statusCode });
}

/** First validation issue as a human sentence (schemas carry their own messages). */
export function validationMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Some of the details are invalid. Please check and try again.';
  const message = issue.message;
  // Zod's built-in messages ("Invalid input: expected string…") are not user-facing.
  if (!message || /^(Invalid|Expected|Unrecognized|Too )/i.test(message)) {
    const field = issue.path.length ? String(issue.path[issue.path.length - 1]) : '';
    return field ? `The ${field} value is invalid. Please check it and try again.` : 'Some of the details are invalid. Please check and try again.';
  }
  return message;
}
