import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

/**
 * Middleware factory to validate a route param is a valid MongoDB ObjectId.
 */
export function validateObjectId(paramName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName] as string;
    if (!mongoose.Types.ObjectId.isValid(value)) {
      const what = paramName.replace(/Id$/, '');
      res.status(404).json({
        error: 'Not Found',
        message: `This ${what} could not be found. Please check the link and try again.`,
        statusCode: 404,
      });
      return;
    }
    next();
  };
}
